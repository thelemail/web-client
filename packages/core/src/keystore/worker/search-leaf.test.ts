// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import { deriveSearchLeaf } from '../productkeys/convert';
import { keyId } from '../productkeys/encoding';
import { fingerprintBytes, secretKeyBytes } from '../productkeys/pgp';
import { ENTRY } from '../productkeys/productBundle';
import { PROFILE } from '../productkeys/profiles';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('../idb', () => ({
	getVault: async () => null,
	getAllVaults: async () => [],
	putVault: async () => undefined,
	deleteVault: async () => undefined,
	clearAllVaults: async () => undefined
}));

const { handleOpenIndex, handleSealIndex } = await import('./content-ops');
const { productVaultState } = await import('./product-vault');
const { indexKeys, vaults } = await import('./state');
type VaultState = import('./state').VaultState;

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const EMAIL = 'calloway@thelemail.test';
const KEY_PASSWORD = 'cGFzc3BocmFzZS1mb3ItdGVzdHMtb25seQ==';

let privateKey: openpgp.PrivateKey;

function legacyVault(): VaultState {
	return {
		accountId: ACCOUNT,
		email: EMAIL,
		authScheme: 'opaque_v1',
		masterKey: new Uint8Array(32).fill(1),
		armoredEncryptedPrivateKey: '',
		privateKey,
		keyPassword: KEY_PASSWORD,
		accountKeys: new Map(),
		keyVersion: 1,
		aliasKeys: new Map(),
		aliasCurrent: new Map()
	};
}

async function productVault(leaf: Uint8Array | null): Promise<VaultState> {
	const id = keyId(ACCOUNT, fingerprintBytes(privateKey));
	return productVaultState(ACCOUNT, EMAIL, {
		product: 'app',
		root: new Uint8Array(32).fill(9),
		currentKeyId: id,
		keys: [
			{ keyId: id, scopeId: ACCOUNT, purpose: ENTRY.mailIdentity, profileId: PROFILE.mailClassic, keyEpoch: 1, material: secretKeyBytes(privateKey) },
			...(leaf
				? [{ keyId: 'aaaaaaaa-0000-4000-8000-000000000002', scopeId: ACCOUNT, purpose: ENTRY.mailSearchIndex, profileId: PROFILE.mailSearchIndex, keyEpoch: 1, material: leaf }]
				: [])
		],
		manifest: null
	});
}

function install(v: VaultState): void {
	indexKeys.delete(ACCOUNT);
	vaults.set(ACCOUNT, v);
}

beforeAll(async () => {
	({ privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: EMAIL }], format: 'object', config: { v6Keys: true } }));
}, 60_000);

describe('mail search index key across custody', () => {
	it('opens chunks sealed by the legacy vault with the product vault, byte for byte', async () => {
		const chunks = ['{"rows":[1,2,3]}', 'thread preview text', ''].map((t) => new TextEncoder().encode(t));
		install(legacyVault());
		const sealed = [];
		for (const plaintext of chunks) {
			const res = await handleSealIndex({ accountId: ACCOUNT, plaintext });
			if (!res.ok) throw new Error('seal failed');
			sealed.push({ iv: res.iv.slice(), ciphertext: res.ciphertext.slice() });
		}

		install(await productVault(await deriveSearchLeaf(KEY_PASSWORD, ACCOUNT)));
		for (const [i, chunk] of sealed.entries()) {
			const res = await handleOpenIndex({ accountId: ACCOUNT, iv: chunk.iv, ciphertext: chunk.ciphertext });
			expect(res.ok, `chunk ${i}`).toBe(true);
			if (res.ok) expect(res.plaintext).toEqual(chunks[i]);
		}

		const fresh = await handleSealIndex({ accountId: ACCOUNT, plaintext: chunks[0] });
		if (!fresh.ok) throw new Error('seal failed');
		install(legacyVault());
		const back = await handleOpenIndex({ accountId: ACCOUNT, iv: fresh.iv, ciphertext: fresh.ciphertext });
		expect(back.ok).toBe(true);
		if (back.ok) expect(back.plaintext).toEqual(chunks[0]);
	});

	it('does not open the index with another leaf', async () => {
		install(legacyVault());
		const sealed = await handleSealIndex({ accountId: ACCOUNT, plaintext: new TextEncoder().encode('row') });
		if (!sealed.ok) throw new Error('seal failed');
		install(await productVault(crypto.getRandomValues(new Uint8Array(32))));
		expect(await handleOpenIndex({ accountId: ACCOUNT, iv: sealed.iv, ciphertext: sealed.ciphertext })).toEqual({ ok: false, code: 'invalid_ciphertext' });
	});

	it('has no index key for a product vault without a leaf', async () => {
		install(await productVault(null));
		expect(await handleSealIndex({ accountId: ACCOUNT, plaintext: new Uint8Array([1]) })).toEqual({ ok: false, code: 'locked' });
	});
});
