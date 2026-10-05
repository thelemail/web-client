import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listMailCollections: vi.fn(), createMailCollection: vi.fn() }));
const seal = vi.hoisted(() => ({ sealCollectionMeta: vi.fn(), openCollectionMeta: vi.fn() }));

vi.mock('$core/api/mailCollections', () => api);
vi.mock('$core/mail/collections/seal', () => seal);
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribe: vi.fn() } }));
vi.mock('$app/environment', () => ({ browser: true }));

import { mailCollections } from './mailCollections.svelte';

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
});
