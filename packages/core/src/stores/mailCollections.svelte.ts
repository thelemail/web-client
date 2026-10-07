import { browser } from '$app/environment';
import { keystore } from '$core/keystore/keystore-client';
import {
	createMailCollection,
	deleteMailCollection,
	listMailCollections,
	reorderMailCollections,
	updateMailCollection
} from '$core/api/mailCollections';
import {
	ApiCallError,
	type FolderDestination,
	type MailCollectionKind,
	type MailCollectionRecord
} from '$core/api/types';
import { openCollectionMeta, sealCollectionMeta, type CollectionMeta } from '$core/mail/collections/seal';
import { CollectionRuleError, moveProblem, nameProblem } from '$core/mail/collections/rules';
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
	#folderIndex = $derived(new Map(this.folders.map((c) => [c.id, c])));
	#labelIndex = $derived(new Map(this.labels.map((c) => [c.id, c])));

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
		return this.#folderIndex.get(id) ?? this.#labelIndex.get(id);
	}

	folder(id: string | null | undefined): CollectionEntry | undefined {
		return id ? this.#folderIndex.get(id) : undefined;
	}

	label(id: string | null | undefined): CollectionEntry | undefined {
		return id ? this.#labelIndex.get(id) : undefined;
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
		const problem = nameProblem(this.nodes, kind, parentId, trimmed);
		if (problem) throw new CollectionRuleError(problem);
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

	setFavorite(id: string, favorite: boolean): Promise<void> {
		return this.#reseal(id, (meta) => ({ ...meta, favorite }));
	}

	rename(id: string, name: string): Promise<void> {
		return this.edit(id, { name });
	}

	recolor(id: string, color: string | null): Promise<void> {
		return this.edit(id, { color });
	}

	edit(id: string, changes: { name?: string; color?: string | null }): Promise<void> {
		const name = changes.name?.trim();
		return this.#reseal(id, (meta, node) => {
			if (name !== undefined && name !== node.name) {
				const problem = nameProblem(this.nodes, node.kind, node.parentId, name, id);
				if (problem) throw new CollectionRuleError(problem);
			}
			return {
				...meta,
				name: name ?? meta.name,
				color: changes.color === undefined ? meta.color : changes.color
			};
		});
	}

	async moveTo(id: string, parentId: string | null): Promise<void> {
		const acct = this.#accountId;
		if (!acct) throw new Error(m.mail_collection_no_account());
		for (let attempt = 0; ; attempt++) {
			const node = this.nodes.find((n) => n.id === id);
			if (!node || node.sealed) throw new Error(m.mail_collection_update_failed());
			if (node.parentId === parentId) return;
			const problem = moveProblem(this.nodes, id, parentId);
			if (problem) throw new CollectionRuleError(problem);
			const position = nextPosition(
				this.nodes.filter((n) => n.kind === node.kind && n.id !== id),
				parentId
			);
			this.#upsert({ ...node, parentId, position });
			try {
				const rec = await updateMailCollection(acct, id, {
					parent: { id: parentId },
					position,
					baseRev: node.rev
				});
				if (this.#accountId !== acct) return;
				this.#upsert(this.#node(rec, node.name, node.color, node.favorite, false));
				return;
			} catch (err) {
				if (this.#accountId !== acct) return;
				const current = this.nodes.find((n) => n.id === id);
				if (current && current.rev === node.rev) this.#upsert(node);
				if (attempt === 0 && err instanceof ApiCallError && err.status === 409) {
					await this.load();
					continue;
				}
				throw err;
			}
		}
	}

	async remove(
		id: string,
		destination?: { kind: FolderDestination; folderId?: string }
	): Promise<void> {
		const acct = this.#accountId;
		if (!acct) throw new Error(m.mail_collection_no_account());
		for (let attempt = 0; ; attempt++) {
			const node = this.nodes.find((n) => n.id === id);
			if (!node) return;
			if (this.hasChildren(id)) throw new CollectionRuleError('has_children');
			const dest = node.kind === 'folder' ? destination : undefined;
			if (node.kind === 'folder') {
				if (!dest) throw new Error(m.mail_collection_update_failed());
				if (dest.kind === 'folder' && (!dest.folderId || dest.folderId === id || !this.folder(dest.folderId))) {
					throw new CollectionRuleError('missing');
				}
			}
			try {
				await deleteMailCollection(acct, id, node.rev, dest);
				if (this.#accountId !== acct) return;
				this.#opened.delete(id);
				this.nodes = this.nodes.filter((n) => n.id !== id);
				return;
			} catch (err) {
				if (this.#accountId !== acct) return;
				if (err instanceof ApiCallError && err.status === 404) {
					await this.sync();
					return;
				}
				if (attempt === 0 && err instanceof ApiCallError && err.status === 409) {
					await this.load();
					continue;
				}
				throw err;
			}
		}
	}

	async #reseal(
		id: string,
		change: (meta: Required<CollectionMeta>, node: CollectionNode) => Required<CollectionMeta>
	): Promise<void> {
		const acct = this.#accountId;
		if (!acct) throw new Error(m.mail_collection_no_account());
		for (let attempt = 0; ; attempt++) {
			const node = this.nodes.find((n) => n.id === id);
			if (!node || node.sealed) throw new Error(m.mail_collection_update_failed());
			const next = change({ name: node.name, color: node.color, favorite: node.favorite }, node);
			if (next.name === node.name && next.color === node.color && next.favorite === node.favorite) return;
			this.#upsert({ ...node, ...next });
			try {
				const sealed = await sealCollectionMeta(acct, next);
				const rec = await updateMailCollection(acct, id, { meta: sealed, baseRev: node.rev });
				if (this.#accountId !== acct) return;
				this.#opened.set(rec.id, { sealedMeta: rec.sealedMeta, ...next });
				this.#upsert(this.#node(rec, next.name, next.color, next.favorite, false));
				return;
			} catch (err) {
				if (this.#accountId !== acct) return;
				const current = this.nodes.find((n) => n.id === id);
				if (current && current.rev === node.rev) this.#upsert(node);
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
