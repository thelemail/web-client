// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
	createVaultDeviceKeys,
	PRUNE_GRACE_MS,
	type DeviceKeyRecord,
	type DeviceKeyStore
} from './vault-device-key';
import { bytesToBase64 } from '../../keystore/opaque-params';

function memoryStore(): DeviceKeyStore & {
	records: Map<string, DeviceKeyRecord>;
} {
	const records = new Map<string, DeviceKeyRecord>();
	return {
		records,
		get: async (id) => records.get(id),
		getAll: async () => [...records.values()],
		put: async (rec) => {
			records.set(rec.accountId, rec);
		},
		delete: async (id) => {
			records.delete(id);
		},
		clear: async () => records.clear()
	};
}

const SERVER_HALF = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));

describe('auth vault device keys', () => {
	it('keeps a non-extractable HKDF key that can only derive bits', async () => {
		const store = memoryStore();
		await createVaultDeviceKeys(store).create('a');
		const { key } = store.records.get('a')!;
		expect(key.extractable).toBe(false);
		expect(key.algorithm.name).toBe('HKDF');
		expect(key.usages).toEqual(['deriveBits']);
		await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
	});

	it('derives a stable 32-byte wrap key per device and server half', async () => {
		const keys = createVaultDeviceKeys(memoryStore());
		await keys.create('a');
		await keys.create('b');
		const a1 = new Uint8Array((await keys.deriveWrapKey('a', SERVER_HALF))!);
		const a2 = new Uint8Array((await keys.deriveWrapKey('a', SERVER_HALF))!);
		const b = new Uint8Array((await keys.deriveWrapKey('b', SERVER_HALF))!);
		const other = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
		const aOther = new Uint8Array((await keys.deriveWrapKey('a', other))!);
		expect(a1.byteLength).toBe(32);
		expect(a1).toEqual(a2);
		expect(a1).not.toEqual(b);
		expect(a1).not.toEqual(aOther);
	});

	it('returns null for an account with no device key', async () => {
		expect(await createVaultDeviceKeys(memoryStore()).deriveWrapKey('x', SERVER_HALF)).toBeNull();
	});

	it('detaches the derived buffer when it is transferred to the worker', async () => {
		const keys = createVaultDeviceKeys(memoryStore());
		await keys.create('a');
		const wrapKey = (await keys.deriveWrapKey('a', SERVER_HALF))!;
		const { port1, port2 } = new MessageChannel();
		port1.postMessage(wrapKey, [wrapKey]);
		expect(wrapKey.byteLength).toBe(0);
		port1.close();
		port2.close();
	});

	it('removes one key or all of them', async () => {
		const store = memoryStore();
		const keys = createVaultDeviceKeys(store);
		await keys.create('a');
		await keys.create('b');
		await keys.remove('a');
		expect([...store.records.keys()]).toEqual(['b']);
		await keys.removeAll();
		expect(store.records.size).toBe(0);
	});

	it('prunes only orphaned keys older than the grace period', async () => {
		const store = memoryStore();
		let t = 1_000_000;
		const keys = createVaultDeviceKeys(store, () => t);
		await keys.create('kept');
		await keys.create('orphan');
		t += PRUNE_GRACE_MS + 1;
		await keys.create('fresh');
		await keys.prune(new Set(['kept']));
		expect([...store.records.keys()].sort()).toEqual(['fresh', 'kept']);
	});
});
