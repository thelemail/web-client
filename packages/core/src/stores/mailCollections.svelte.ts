import { browser } from '$app/environment';
import { keystore } from '$core/keystore/keystore-client';
import { createMailCollection, listMailCollections } from '$core/api/mailCollections';
import type { MailCollectionKind, MailCollectionRecord } from '$core/api/types';
import { openCollectionMeta, sealCollectionMeta } from '$core/mail/collections/seal';
import {
	nextPosition,
	orderTree,
	subtreeIds,
	type CollectionEntry,
	type CollectionNode
} from '$core/mail/collections/tree';
import { m } from '$paraglide/messages.js';

class MailCollectionsStore {
	nodes = $state<CollectionNode[]>([]);
	loaded = $state(false);
	locked = $state(false);
	error = $state<string | null>(null);

	folders = $derived<CollectionEntry[]>(
		orderTree(this.nodes.filter((n) => n.kind === 'folder'))
	);
	labels = $derived<CollectionEntry[]>(orderTree(this.nodes.filter((n) => n.kind === 'label')));

	#accountId: string | null = null;
	#ready: Promise<void> | null = null;
	#watching = false;
	#opened = new Map<string, { sealedMeta: string; name: string; color: string | null }>();

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
		this.#watch();
	}

	clear(): void {
		this.nodes = [];
		this.loaded = false;
		this.locked = false;
		this.error = null;
		this.#ready = null;
		this.#opened.clear();
	}

	#watch(): void {
		if (!browser || this.#watching) return;
		this.#watching = true;
		keystore.subscribe((b) => {
			if (b.type === 'clearedAll' || (b.type === 'cleared' && b.accountId === this.#accountId)) {
				this.clear();
				return;
			}
			if (b.type === 'vaultChanged' && b.accountId === this.#accountId && this.locked) {
				void this.load();
			}
		});
	}

	ready(): Promise<void> {
		this.#ready ??= this.#fetch();
		return this.#ready;
	}

	load(): Promise<void> {
		this.#ready = this.#fetch();
		return this.#ready;
	}

	async sync(): Promise<boolean> {
		const before = this.#shape();
		await this.load();
		return this.#shape() !== before;
	}

	async applyHint(hint: { kind: string; id?: string; rev?: number }): Promise<boolean> {
		if (hint.id && hint.rev !== undefined) {
			const known = this.nodes.find((n) => n.id === hint.id);
			const settled = hint.kind.endsWith('.deleted') ? !known : !!known && known.rev >= hint.rev;
			if (settled) return false;
		}
		return this.sync();
	}

	#shape(): string {
		return this.nodes
			.map((n) => `${n.id}:${n.rev}:${n.parentId ?? ''}`)
			.sort()
			.join('|');
	}

	byId(id: string | null | undefined): CollectionEntry | undefined {
		if (!id) return undefined;
		return this.folders.find((c) => c.id === id) ?? this.labels.find((c) => c.id === id);
	}

	folder(id: string | null | undefined): CollectionEntry | undefined {
		return id ? this.folders.find((c) => c.id === id) : undefined;
	}

	label(id: string | null | undefined): CollectionEntry | undefined {
		return id ? this.labels.find((c) => c.id === id) : undefined;
	}

	subtree = (id: string): string[] => subtreeIds(this.nodes, id);

	hasChildren(id: string | null | undefined): boolean {
		return !!id && this.nodes.some((n) => n.parentId === id);
	}

	async create(
		kind: MailCollectionKind,
		name: string,
		color: string | null,
		parentId: string | null = null
	): Promise<CollectionEntry> {
		const acct = this.#accountId;
		if (!acct) throw new Error(m.mail_collection_no_account());
		const trimmed = name.trim();
		const sealed = await sealCollectionMeta(acct, { name: trimmed, color });
		const rec = await createMailCollection(acct, {
			kind,
			parentId,
			position: nextPosition(
				this.nodes.filter((n) => n.kind === kind),
				parentId
			),
			...sealed
		});
		this.#opened.set(rec.id, { sealedMeta: rec.sealedMeta, name: trimmed, color });
		if (this.#accountId === acct) this.#upsert(this.#node(rec, trimmed, color, false));
		const entry = this.byId(rec.id);
		if (!entry) throw new Error(m.mail_collection_create_failed());
		return entry;
	}

	async #fetch(): Promise<void> {
		const acct = this.#accountId;
		if (!browser || !acct) {
			this.loaded = true;
			return;
		}
		try {
			const { collections } = await listMailCollections(acct);
			if (this.#accountId !== acct) return;
			const next: CollectionNode[] = [];
			let anyLocked = false;
			for (const rec of collections) {
				if (rec.deleted) {
					this.#opened.delete(rec.id);
					continue;
				}
				const cached = this.#opened.get(rec.id);
				if (cached && cached.sealedMeta === rec.sealedMeta) {
					next.push(this.#node(rec, cached.name, cached.color, false));
					continue;
				}
				const meta = await openCollectionMeta(acct, rec.sealedMeta);
				if (this.#accountId !== acct) return;
				if (!meta) {
					anyLocked = true;
					next.push(this.#node(rec, m.mail_collection_locked_name(), null, true));
					continue;
				}
				this.#opened.set(rec.id, { sealedMeta: rec.sealedMeta, ...meta });
				next.push(this.#node(rec, meta.name, meta.color, false));
			}
			this.nodes = next;
			this.locked = anyLocked;
			this.error = null;
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : m.mail_collection_load_failed();
		} finally {
			if (this.#accountId === acct) this.loaded = true;
		}
	}

	#node(rec: MailCollectionRecord, name: string, color: string | null, sealed: boolean): CollectionNode {
		return {
			id: rec.id,
			kind: rec.kind,
			parentId: rec.parentId ?? null,
			position: rec.position,
			rev: rec.rev,
			name,
			color,
			sealed
		};
	}

	#upsert(node: CollectionNode): void {
		const rest = this.nodes.filter((n) => n.id !== node.id);
		this.nodes = [...rest, node];
	}
}

export const mailCollections = new MailCollectionsStore();
