import { browser } from '$app/environment';
import { keystore } from '$core/keystore/keystore-client';
import {
	createMailCollection,
	listMailCollections,
	reorderMailCollections,
	updateMailCollection
} from '$core/api/mailCollections';
import { ApiCallError, type MailCollectionKind, type MailCollectionRecord } from '$core/api/types';
import { openCollectionMeta, sealCollectionMeta } from '$core/mail/collections/seal';
import {
	nextPosition,
	orderTree,
	POSITION_STEP,
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
	favorites = $derived<CollectionEntry[]>(
		[...this.folders, ...this.labels].filter((c) => c.favorite && !c.sealed)
	);

	#accountId: string | null = null;
	#ready: Promise<void> | null = null;
	#watching = false;
	#opened = new Map<
		string,
		{ sealedMeta: string; name: string; color: string | null; favorite: boolean }
	>();

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
		this.#opened.set(rec.id, { sealedMeta: rec.sealedMeta, name: trimmed, color, favorite: false });
		if (this.#accountId === acct) this.#upsert(this.#node(rec, trimmed, color, false, false));
		const entry = this.byId(rec.id);
		if (!entry) throw new Error(m.mail_collection_create_failed());
		return entry;
	}

	async setFavorite(id: string, favorite: boolean): Promise<void> {
		const acct = this.#accountId;
		if (!acct) throw new Error(m.mail_collection_no_account());
		for (let attempt = 0; ; attempt++) {
			const node = this.nodes.find((n) => n.id === id);
			if (!node || node.sealed) throw new Error(m.mail_collection_update_failed());
			if (node.favorite === favorite) return;
			const before = node;
			this.#upsert({ ...node, favorite });
			try {
				const sealed = await sealCollectionMeta(acct, { name: node.name, color: node.color, favorite });
				const rec = await updateMailCollection(acct, id, { meta: sealed, baseRev: node.rev });
				if (this.#accountId !== acct) return;
				this.#opened.set(rec.id, {
					sealedMeta: rec.sealedMeta,
					name: node.name,
					color: node.color,
					favorite
				});
				this.#upsert(this.#node(rec, node.name, node.color, favorite, false));
				return;
			} catch (err) {
				if (this.#accountId !== acct) return;
				const current = this.nodes.find((n) => n.id === id);
				if (current && current.rev === before.rev) this.#upsert(before);
				if (attempt === 0 && err instanceof ApiCallError && err.status === 409) {
					await this.load();
					continue;
				}
				throw err;
			}
		}
	}

	async reorder(kind: MailCollectionKind, parentId: string | null, orderedIds: string[]): Promise<void> {
		const acct = this.#accountId;
		if (!acct || orderedIds.length === 0) return;
		const before = this.nodes;
		const items = orderedIds.map((id) => {
			const n = before.find((x) => x.id === id && x.kind === kind);
			if (!n) throw new Error(m.mail_collection_update_failed());
			return { id, baseRev: n.rev };
		});
		const rank = new Map(orderedIds.map((id, i) => [id, (i + 1) * POSITION_STEP]));
		this.nodes = before.map((n) => (rank.has(n.id) ? { ...n, position: rank.get(n.id)! } : n));
		try {
			const { collections } = await reorderMailCollections(acct, { kind, parentId, items });
			if (this.#accountId !== acct) return;
			const fresh = new Map(collections.map((r) => [r.id, r]));
			this.nodes = this.nodes.map((n) => {
				const r = fresh.get(n.id);
				return r ? { ...n, position: r.position, rev: r.rev } : n;
			});
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.nodes = before;
			if (err instanceof ApiCallError && err.status === 409) await this.sync();
			throw err;
		}
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
					next.push(this.#node(rec, cached.name, cached.color, cached.favorite, false));
					continue;
				}
				const meta = await openCollectionMeta(acct, rec.sealedMeta);
				if (this.#accountId !== acct) return;
				if (!meta) {
					anyLocked = true;
					next.push(this.#node(rec, m.mail_collection_locked_name(), null, false, true));
					continue;
				}
				const favorite = meta.favorite === true;
				this.#opened.set(rec.id, { sealedMeta: rec.sealedMeta, ...meta, favorite });
				next.push(this.#node(rec, meta.name, meta.color, favorite, false));
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

	#node(
		rec: MailCollectionRecord,
		name: string,
		color: string | null,
		favorite: boolean,
		sealed: boolean
	): CollectionNode {
		return {
			id: rec.id,
			kind: rec.kind,
			parentId: rec.parentId ?? null,
			position: rec.position,
			rev: rec.rev,
			name,
			color,
			favorite,
			sealed
		};
	}

	#upsert(node: CollectionNode): void {
		const rest = this.nodes.filter((n) => n.id !== node.id);
		this.nodes = [...rest, node];
	}
}

export const mailCollections = new MailCollectionsStore();
