import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	listMailCollections: vi.fn(),
	createMailCollection: vi.fn(),
	updateMailCollection: vi.fn(),
	reorderMailCollections: vi.fn(),
	deleteMailCollection: vi.fn()
}));
const seal = vi.hoisted(() => ({ sealCollectionMeta: vi.fn(), openCollectionMeta: vi.fn() }));

vi.mock('$core/api/mailCollections', () => api);
vi.mock('$core/mail/collections/seal', () => seal);
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribe: vi.fn() } }));
vi.mock('$app/environment', () => ({ browser: true }));

import { mailCollections } from './mailCollections.svelte';
import { ApiCallError } from '$core/api/types';
import { CollectionRuleError } from '$core/mail/collections/rules';

function rec(id: string, kind: 'folder' | 'label', sealedMeta: string, over: Record<string, unknown> = {}) {
	return {
		id,
		kind,
		parentId: null,
		position: 1024,
		sealedMeta,
		metaKeyFingerprint: 'fp',
		metaSchemaVersion: 1,
		rev: 1,
		deleted: false,
		createdAt: '2026-10-01T00:00:00Z',
		updatedAt: '2026-10-01T00:00:00Z',
		...over
	};
}

describe('mail collections registry', () => {
	beforeEach(() => {
		api.listMailCollections.mockReset();
		api.createMailCollection.mockReset();
		api.updateMailCollection.mockReset();
		api.reorderMailCollections.mockReset();
		api.deleteMailCollection.mockReset();
		seal.openCollectionMeta.mockReset();
		seal.sealCollectionMeta.mockReset();
		mailCollections.setAccount(null);
		mailCollections.setAccount('acc-1');
	});

	it('decrypts names, drops tombstones and keeps unreadable entries as locked', async () => {
		api.listMailCollections.mockResolvedValue({
			collections: [
				rec('f1', 'folder', 'sealed-clients'),
				rec('f2', 'folder', 'sealed-acme', { parentId: 'f1' }),
				rec('l1', 'label', 'sealed-tax'),
				rec('l2', 'label', 'sealed-gone', { deleted: true }),
				rec('l3', 'label', 'sealed-foreign-key', { position: 4096 })
			]
		});
		seal.openCollectionMeta.mockImplementation(async (_acct: string, sealed: string) => {
			if (sealed === 'sealed-foreign-key') return null;
			return { name: sealed.replace('sealed-', ''), color: null };
		});

		await mailCollections.load();

		expect(mailCollections.folders.map((f) => f.path)).toEqual(['clients', 'clients / acme']);
		expect(mailCollections.labels.map((l) => [l.id, l.sealed])).toEqual([
			['l1', false],
			['l3', true]
		]);
		expect(mailCollections.locked).toBe(true);
		expect(mailCollections.label('l2')).toBeUndefined();
	});

	it('does not decrypt again when the sealed metadata is unchanged', async () => {
		api.listMailCollections.mockResolvedValue({ collections: [rec('l1', 'label', 'sealed-tax')] });
		seal.openCollectionMeta.mockResolvedValue({ name: 'tax', color: 'pine' });

		await mailCollections.load();
		await mailCollections.load();

		expect(seal.openCollectionMeta).toHaveBeenCalledTimes(1);
	});

	it('creates a sealed collection after the last sibling and exposes it at once', async () => {
		api.listMailCollections.mockResolvedValue({
			collections: [rec('f1', 'folder', 'sealed-clients', { position: 2048 })]
		});
		seal.openCollectionMeta.mockResolvedValue({ name: 'clients', color: null });
		await mailCollections.load();

		seal.sealCollectionMeta.mockResolvedValue({
			sealedMeta: 'sealed-new',
			metaKeyFingerprint: 'fp',
			metaSchemaVersion: 1
		});
		api.createMailCollection.mockImplementation(async (_acct: string, body: { position: number }) =>
			rec('f9', 'folder', 'sealed-new', { position: body.position })
		);

		const created = await mailCollections.create('folder', '  Invoices ', 'brass');

		expect(seal.sealCollectionMeta).toHaveBeenCalledWith('acc-1', { name: 'Invoices', color: 'brass' });
		expect(api.createMailCollection.mock.calls[0][1]).toMatchObject({ kind: 'folder', position: 3072 });
		expect(created.name).toBe('Invoices');
		expect(mailCollections.folders.map((f) => f.name)).toEqual(['clients', 'Invoices']);
	});

	it('skips a hint it already reflects and reports whether a fetch reshaped the tree', async () => {
		seal.openCollectionMeta.mockImplementation(async (_acct: string, sealed: string) => ({
			name: sealed.replace('sealed-', ''),
			color: null
		}));
		api.listMailCollections.mockResolvedValue({
			collections: [rec('f1', 'folder', 'sealed-clients'), rec('f2', 'folder', 'sealed-acme', { rev: 2 })]
		});
		await mailCollections.load();
		api.listMailCollections.mockClear();

		expect(await mailCollections.applyHint({ kind: 'mail_collection.updated', id: 'f2', rev: 2 })).toBe(false);
		expect(await mailCollections.applyHint({ kind: 'mail_collection.deleted', id: 'gone', rev: 5 })).toBe(false);
		expect(api.listMailCollections).not.toHaveBeenCalled();

		api.listMailCollections.mockResolvedValue({
			collections: [
				rec('f1', 'folder', 'sealed-clients'),
				rec('f2', 'folder', 'sealed-acme', { rev: 3, parentId: 'f1' })
			]
		});
		expect(await mailCollections.applyHint({ kind: 'mail_collection.updated', id: 'f2', rev: 3 })).toBe(true);
		expect(mailCollections.subtree('f1')).toEqual(['f1', 'f2']);

		expect(await mailCollections.sync()).toBe(false);
	});

	it('pins a favorite by resealing its name and color with the flag', async () => {
		api.listMailCollections.mockResolvedValue({
			collections: [rec('f1', 'folder', 'sealed-clients', { rev: 4 }), rec('l1', 'label', 'sealed-tax')]
		});
		seal.openCollectionMeta.mockImplementation(async (_acct: string, sealed: string) => ({
			name: sealed.replace('sealed-', ''),
			color: sealed === 'sealed-clients' ? 'pine' : null,
			favorite: false
		}));
		await mailCollections.load();
		expect(mailCollections.favorites).toEqual([]);

		seal.sealCollectionMeta.mockResolvedValue({ sealedMeta: 'sealed-fav', metaKeyFingerprint: 'fp', metaSchemaVersion: 2 });
		api.updateMailCollection.mockResolvedValue(rec('f1', 'folder', 'sealed-fav', { rev: 5 }));

		await mailCollections.setFavorite('f1', true);

		expect(seal.sealCollectionMeta).toHaveBeenCalledWith('acc-1', {
			name: 'clients',
			color: 'pine',
			favorite: true
		});
		expect(api.updateMailCollection).toHaveBeenCalledWith('acc-1', 'f1', {
			meta: { sealedMeta: 'sealed-fav', metaKeyFingerprint: 'fp', metaSchemaVersion: 2 },
			baseRev: 4
		});
		expect(mailCollections.favorites.map((f) => [f.id, f.rev])).toEqual([['f1', 5]]);

		seal.openCollectionMeta.mockClear();
		api.listMailCollections.mockResolvedValue({
			collections: [rec('f1', 'folder', 'sealed-fav', { rev: 5 }), rec('l1', 'label', 'sealed-tax')]
		});
		await mailCollections.load();
		expect(seal.openCollectionMeta).not.toHaveBeenCalledWith('acc-1', 'sealed-fav');
		expect(mailCollections.folder('f1')?.favorite).toBe(true);
	});

	it('reloads and retries once when another device changed the collection first', async () => {
		api.listMailCollections.mockResolvedValueOnce({
			collections: [rec('f1', 'folder', 'sealed-clients', { rev: 1 })]
		});
		seal.openCollectionMeta.mockResolvedValue({ name: 'clients', color: null, favorite: false });
		await mailCollections.load();

		api.listMailCollections.mockResolvedValueOnce({
			collections: [rec('f1', 'folder', 'sealed-renamed', { rev: 2 })]
		});
		seal.openCollectionMeta.mockResolvedValue({ name: 'Clients 2026', color: 'brass', favorite: false });
		seal.sealCollectionMeta.mockResolvedValue({ sealedMeta: 'x', metaKeyFingerprint: 'fp', metaSchemaVersion: 2 });
		api.updateMailCollection
			.mockRejectedValueOnce(new ApiCallError(409, null, 'stale'))
			.mockResolvedValueOnce(rec('f1', 'folder', 'x', { rev: 3 }));

		await mailCollections.setFavorite('f1', true);

		expect(api.updateMailCollection).toHaveBeenCalledTimes(2);
		expect(api.updateMailCollection.mock.calls[1][2].baseRev).toBe(2);
		expect(seal.sealCollectionMeta).toHaveBeenLastCalledWith('acc-1', {
			name: 'Clients 2026',
			color: 'brass',
			favorite: true
		});
		expect(mailCollections.folder('f1')?.favorite).toBe(true);
	});

	it('puts a favorite back when the server refuses the change', async () => {
		api.listMailCollections.mockResolvedValue({ collections: [rec('f1', 'folder', 'sealed-clients')] });
		seal.openCollectionMeta.mockResolvedValue({ name: 'clients', color: null, favorite: true });
		await mailCollections.load();
		seal.sealCollectionMeta.mockResolvedValue({ sealedMeta: 'x', metaKeyFingerprint: 'fp', metaSchemaVersion: 2 });
		api.updateMailCollection.mockRejectedValue(new ApiCallError(500, null, 'boom'));

		await expect(mailCollections.setFavorite('f1', false)).rejects.toThrow('boom');

		expect(api.updateMailCollection).toHaveBeenCalledTimes(1);
		expect(mailCollections.folder('f1')?.favorite).toBe(true);
	});

	it('reorders siblings at once and keeps the revisions the server returns', async () => {
		api.listMailCollections.mockResolvedValue({
			collections: [
				rec('a', 'folder', 'sealed-a', { position: 1024, rev: 3 }),
				rec('b', 'folder', 'sealed-b', { position: 2048, rev: 1 }),
				rec('c', 'folder', 'sealed-c', { position: 3072, rev: 2 })
			]
		});
		seal.openCollectionMeta.mockImplementation(async (_a: string, s: string) => ({
			name: s.replace('sealed-', ''),
			color: null,
			favorite: false
		}));
		await mailCollections.load();

		let resolve!: (v: unknown) => void;
		api.reorderMailCollections.mockReturnValue(new Promise((r) => (resolve = r)));
		const done = mailCollections.reorder('folder', null, ['c', 'a', 'b']);

		expect(mailCollections.folders.map((f) => f.id)).toEqual(['c', 'a', 'b']);
		expect(api.reorderMailCollections).toHaveBeenCalledWith('acc-1', {
			kind: 'folder',
			parentId: null,
			items: [
				{ id: 'c', baseRev: 2 },
				{ id: 'a', baseRev: 3 },
				{ id: 'b', baseRev: 1 }
			]
		});

		resolve({
			collections: [
				rec('c', 'folder', 'sealed-c', { position: 1024, rev: 3 }),
				rec('a', 'folder', 'sealed-a', { position: 2048, rev: 4 }),
				rec('b', 'folder', 'sealed-b', { position: 3072, rev: 2 })
			]
		});
		await done;

		expect(mailCollections.folders.map((f) => [f.id, f.rev])).toEqual([
			['c', 3],
			['a', 4],
			['b', 2]
		]);
	});

	it('rolls a refused reorder back and resyncs when the siblings changed elsewhere', async () => {
		api.listMailCollections.mockResolvedValueOnce({
			collections: [
				rec('a', 'folder', 'sealed-a', { position: 1024 }),
				rec('b', 'folder', 'sealed-b', { position: 2048 })
			]
		});
		seal.openCollectionMeta.mockImplementation(async (_a: string, s: string) => ({
			name: s.replace('sealed-', ''),
			color: null,
			favorite: false
		}));
		await mailCollections.load();

		api.reorderMailCollections.mockRejectedValue(new ApiCallError(409, null, 'changed'));
		api.listMailCollections.mockResolvedValueOnce({
			collections: [
				rec('a', 'folder', 'sealed-a', { position: 1024 }),
				rec('b', 'folder', 'sealed-b', { position: 2048 }),
				rec('n', 'folder', 'sealed-n', { position: 4096 })
			]
		});

		await expect(mailCollections.reorder('folder', null, ['b', 'a'])).rejects.toThrow('changed');

		expect(mailCollections.folders.map((f) => f.id)).toEqual(['a', 'b', 'n']);
	});

	async function loadTree(records: ReturnType<typeof rec>[], favorite = false) {
		api.listMailCollections.mockResolvedValue({ collections: records });
		seal.openCollectionMeta.mockImplementation(async (_a: string, s: string) => ({
			name: s.replace('sealed-', ''),
			color: s === 'sealed-clients' ? 'pine' : null,
			favorite
		}));
		await mailCollections.load();
		seal.sealCollectionMeta.mockResolvedValue({ sealedMeta: 'resealed', metaKeyFingerprint: 'fp', metaSchemaVersion: 2 });
	}

	it('renames without dropping the color or the favorite flag', async () => {
		await loadTree([rec('f1', 'folder', 'sealed-clients', { rev: 2 })], true);
		api.updateMailCollection.mockResolvedValue(rec('f1', 'folder', 'resealed', { rev: 3 }));

		await mailCollections.rename('f1', '  Clients 2026 ');

		expect(seal.sealCollectionMeta).toHaveBeenCalledWith('acc-1', {
			name: 'Clients 2026',
			color: 'pine',
			favorite: true
		});
		expect(api.updateMailCollection.mock.calls[0][2]).toEqual({
			meta: { sealedMeta: 'resealed', metaKeyFingerprint: 'fp', metaSchemaVersion: 2 },
			baseRev: 2
		});
		expect(mailCollections.folder('f1')).toMatchObject({ name: 'Clients 2026', favorite: true, rev: 3 });
	});

	it('recolors by resealing the existing name', async () => {
		await loadTree([rec('l1', 'label', 'sealed-tax')]);
		api.updateMailCollection.mockResolvedValue(rec('l1', 'label', 'resealed', { rev: 2 }));

		await mailCollections.recolor('l1', 'danger');

		expect(seal.sealCollectionMeta).toHaveBeenCalledWith('acc-1', { name: 'tax', color: 'danger', favorite: false });
		expect(mailCollections.label('l1')?.color).toBe('danger');
	});

	it('refuses a rename that clashes with a sibling and leaves the server alone', async () => {
		await loadTree([
			rec('f1', 'folder', 'sealed-clients'),
			rec('f2', 'folder', 'sealed-acme'),
			rec('f3', 'folder', 'sealed-acme', { parentId: 'f1' })
		]);

		await expect(mailCollections.rename('f1', 'ACME')).rejects.toBeInstanceOf(CollectionRuleError);
		await expect(mailCollections.rename('f1', 'a/b')).rejects.toMatchObject({ problem: 'slash' });
		await mailCollections.rename('f1', 'clients');

		expect(api.updateMailCollection).not.toHaveBeenCalled();
		expect(mailCollections.folder('f1')?.name).toBe('clients');
	});

	it('restores the old name when the server refuses a rename', async () => {
		await loadTree([rec('f1', 'folder', 'sealed-clients')]);
		api.updateMailCollection.mockRejectedValue(new ApiCallError(500, null, 'boom'));

		await expect(mailCollections.rename('f1', 'Work')).rejects.toThrow('boom');

		expect(mailCollections.folder('f1')?.name).toBe('clients');
	});

	it('moves a folder under a new parent at the end of its new siblings', async () => {
		await loadTree([
			rec('a', 'folder', 'sealed-a', { position: 1024 }),
			rec('b', 'folder', 'sealed-b', { position: 2048, rev: 4 }),
			rec('c', 'folder', 'sealed-c', { parentId: 'a', position: 5120 })
		]);
		api.updateMailCollection.mockImplementation(async (_acct: string, _id: string, body: { position: number }) =>
			rec('b', 'folder', 'sealed-b', { parentId: 'a', position: body.position, rev: 5 })
		);

		await mailCollections.moveTo('b', 'a');

		expect(api.updateMailCollection).toHaveBeenCalledWith('acc-1', 'b', {
			parent: { id: 'a' },
			position: 6144,
			baseRev: 4
		});
		expect(mailCollections.folders.map((f) => f.path)).toEqual(['a', 'a / c', 'a / b']);
		expect(mailCollections.folder('b')?.rev).toBe(5);
	});

	it('moves to the top level with an explicit null parent', async () => {
		await loadTree([rec('a', 'folder', 'sealed-a'), rec('c', 'folder', 'sealed-c', { parentId: 'a' })]);
		api.updateMailCollection.mockResolvedValue(rec('c', 'folder', 'sealed-c', { position: 2048, rev: 2 }));

		await mailCollections.moveTo('c', null);

		expect(api.updateMailCollection.mock.calls[0][2]).toMatchObject({ parent: { id: null }, position: 2048 });
		expect(mailCollections.folders.map((f) => f.path)).toEqual(['a', 'c']);
	});

	it('refuses cycles, foreign kinds, clashes and moves past the depth limit before calling the server', async () => {
		const chain = Array.from({ length: 15 }, (_, i) =>
			rec(`d${i}`, 'folder', `sealed-d${i}`, { parentId: i ? `d${i - 1}` : null })
		);
		await loadTree([
			...chain,
			rec('x', 'folder', 'sealed-x'),
			rec('y', 'folder', 'sealed-y', { parentId: 'x' }),
			rec('l1', 'label', 'sealed-l1')
		]);
		api.updateMailCollection.mockResolvedValue(rec('y', 'folder', 'sealed-y', { parentId: 'd14', rev: 2 }));

		await expect(mailCollections.moveTo('d0', 'd3')).rejects.toMatchObject({ problem: 'inside' });
		await expect(mailCollections.moveTo('x', 'x')).rejects.toMatchObject({ problem: 'inside' });
		await expect(mailCollections.moveTo('x', 'l1')).rejects.toMatchObject({ problem: 'missing' });
		await expect(mailCollections.moveTo('x', 'd14')).rejects.toMatchObject({ problem: 'too_deep' });
		await mailCollections.moveTo('y', 'd14');
		expect(api.updateMailCollection).toHaveBeenCalledTimes(1);

		await loadTree([rec('p', 'folder', 'sealed-p'), rec('q', 'folder', 'sealed-q'), rec('q2', 'folder', 'sealed-q', { parentId: 'p' })]);
		api.updateMailCollection.mockClear();
		await expect(mailCollections.moveTo('q2', null)).rejects.toMatchObject({ problem: 'duplicate' });
		expect(api.updateMailCollection).not.toHaveBeenCalled();
	});

	it('retries a move once against fresh revisions and rolls back a final refusal', async () => {
		await loadTree([rec('a', 'folder', 'sealed-a'), rec('b', 'folder', 'sealed-b', { rev: 1 })]);
		api.listMailCollections.mockResolvedValue({
			collections: [rec('a', 'folder', 'sealed-a'), rec('b', 'folder', 'sealed-b', { rev: 2 })]
		});
		api.updateMailCollection.mockRejectedValue(new ApiCallError(409, null, 'stale'));

		await expect(mailCollections.moveTo('b', 'a')).rejects.toThrow('stale');

		expect(api.updateMailCollection).toHaveBeenCalledTimes(2);
		expect(api.updateMailCollection.mock.calls[1][2].baseRev).toBe(2);
		expect(mailCollections.folder('b')?.parentId).toBeNull();
	});

	it('deletes a label without a destination and a folder with the one chosen', async () => {
		await loadTree([
			rec('f1', 'folder', 'sealed-f1', { rev: 3 }),
			rec('f2', 'folder', 'sealed-f2'),
			rec('l1', 'label', 'sealed-l1', { rev: 7 })
		]);
		api.deleteMailCollection.mockResolvedValue({});

		await mailCollections.remove('l1', { kind: 'archive' });
		await mailCollections.remove('f1', { kind: 'folder', folderId: 'f2' });

		expect(api.deleteMailCollection.mock.calls).toEqual([
			['acc-1', 'l1', 7, undefined],
			['acc-1', 'f1', 3, { kind: 'folder', folderId: 'f2' }]
		]);
		expect(mailCollections.nodes.map((n) => n.id)).toEqual(['f2']);
	});

	it('will not delete a folder that still has subfolders or has nowhere to send its mail', async () => {
		await loadTree([rec('a', 'folder', 'sealed-a'), rec('b', 'folder', 'sealed-b', { parentId: 'a' })]);

		await expect(mailCollections.remove('a', { kind: 'archive' })).rejects.toMatchObject({ problem: 'has_children' });
		await expect(mailCollections.remove('b')).rejects.toThrow();
		await expect(mailCollections.remove('b', { kind: 'folder', folderId: 'b' })).rejects.toMatchObject({ problem: 'missing' });
		expect(api.deleteMailCollection).not.toHaveBeenCalled();
	});

	it('puts a folder back when its deletion fails', async () => {
		await loadTree([rec('a', 'folder', 'sealed-a')]);
		api.deleteMailCollection.mockRejectedValue(new ApiCallError(500, null, 'boom'));

		await expect(mailCollections.remove('a', { kind: 'inbox' })).rejects.toThrow('boom');

		expect(mailCollections.folder('a')?.name).toBe('a');
	});

	it('treats a folder already deleted elsewhere as done', async () => {
		await loadTree([rec('a', 'folder', 'sealed-a')]);
		api.deleteMailCollection.mockRejectedValue(new ApiCallError(404, null, 'gone'));
		api.listMailCollections.mockResolvedValue({ collections: [rec('a', 'folder', 'sealed-a', { deleted: true })] });

		await mailCollections.remove('a', { kind: 'inbox' });

		expect(mailCollections.folder('a')).toBeUndefined();
	});
});
