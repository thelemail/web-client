import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	listMailCollections: vi.fn(),
	createMailCollection: vi.fn(),
	updateMailCollection: vi.fn(),
	reorderMailCollections: vi.fn()
}));
const seal = vi.hoisted(() => ({ sealCollectionMeta: vi.fn(), openCollectionMeta: vi.fn() }));

vi.mock('$core/api/mailCollections', () => api);
vi.mock('$core/mail/collections/seal', () => seal);
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribe: vi.fn() } }));
vi.mock('$app/environment', () => ({ browser: true }));

import { mailCollections } from './mailCollections.svelte';
import { ApiCallError } from '$core/api/types';

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
});
