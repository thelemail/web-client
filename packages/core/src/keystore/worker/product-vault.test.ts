// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import { keyId } from '../productkeys/encoding';
import { ProductKeysError } from '../productkeys/errors';
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

const { decodeProductVault, encodeProductVault, productVaultState, wipeProductVault } = await import('./product-vault');
const { accountKeysByVersion, fingerprintHexOf } = await import('./state');
type ProductVault = import('./product-vault').ProductVault;

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const ALIAS = '8b9c0d1e-2f3a-4b4c-9d6e-7f8091a2b3c4';
const OTHER_ALIAS = '9c0d1e2f-3a4b-4c5d-8e6f-708192a3b4c5';
const EMAIL = 'calloway@thelemail.test';

async function key(email: string): Promise<openpgp.PrivateKey> {
	const { privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email }], format: 'object', config: { v6Keys: true } });
	return privateKey;
}

let identities: openpgp.PrivateKey[];
let aliases: openpgp.PrivateKey[];
let leaf: Uint8Array;
let dedup: Uint8Array;

function idOf(scope: string, k: openpgp.PrivateKey): string {
	return keyId(scope, fingerprintBytes(k));
}

function mailVault(current: number): ProductVault {
	const keys = [
		...identities.map((k, i) => ({ keyId: idOf(ACCOUNT, k), scopeId: ACCOUNT, purpose: ENTRY.mailIdentity, profileId: PROFILE.mailClassic, keyEpoch: i + 1, material: secretKeyBytes(k) })),
		{ keyId: idOf(ALIAS, aliases[0]), scopeId: ALIAS, purpose: ENTRY.mailAlias, profileId: PROFILE.mailClassic, keyEpoch: 2, material: secretKeyBytes(aliases[0]), alias: { aliasId: 'alias-team', addressId: 'addr-team', email: 'team@thelemail.test' } },
		{ keyId: idOf(OTHER_ALIAS, aliases[1]), scopeId: OTHER_ALIAS, purpose: ENTRY.mailAlias, profileId: PROFILE.mailClassic, keyEpoch: 1, material: secretKeyBytes(aliases[1]) },
		{ keyId: 'aaaaaaaa-0000-4000-8000-000000000001', scopeId: ACCOUNT, purpose: ENTRY.mailImportDedup, profileId: PROFILE.mailImportDedup, keyEpoch: 1, material: dedup.slice() },
		{ keyId: 'aaaaaaaa-0000-4000-8000-000000000002', scopeId: ACCOUNT, purpose: ENTRY.mailSearchIndex, profileId: PROFILE.mailSearchIndex, keyEpoch: 1, material: leaf.slice() }
	].sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
	return {
		product: 'app',
		root: new Uint8Array(32).fill(9),
		currentKeyId: idOf(ACCOUNT, identities[current]),
		keys,
		manifest: { manifestId: 'bbbbbbbb-0000-4000-8000-000000000001', revision: 3, hash: new Uint8Array(32).fill(4), productKeyEpoch: 1 }
	};
}

function roundTrip(vault: ProductVault): ProductVault {
	return decodeProductVault(new TextDecoder().decode(encodeProductVault(vault)));
}

beforeAll(async () => {
	identities = [await key('calloway1@thelemail.test'), await key('calloway2@thelemail.test'), await key('calloway3@thelemail.test')];
	aliases = [await key('team@thelemail.test'), await key('desk@thelemail.test')];
	leaf = crypto.getRandomValues(new Uint8Array(32));
	dedup = crypto.getRandomValues(new Uint8Array(32));
}, 60_000);

describe('product vault codec', () => {
	it('round-trips the whole mail keyring', () => {
		const vault = mailVault(1);
		const back = roundTrip(vault);
		expect(back.product).toBe('app');
		expect(back.root).toEqual(vault.root);
		expect(back.currentKeyId).toBe(vault.currentKeyId);
		expect(back.manifest).toEqual(vault.manifest);
		expect(back.keys).toEqual(vault.keys);
		expect(back.keys.map((k) => k.purpose).sort()).toEqual(
			[ENTRY.mailAlias, ENTRY.mailAlias, ENTRY.mailIdentity, ENTRY.mailIdentity, ENTRY.mailIdentity, ENTRY.mailImportDedup, ENTRY.mailSearchIndex].sort()
		);
	});

	it('restores every identity key and makes the committed one current', async () => {
		const state = await productVaultState(ACCOUNT, EMAIL, roundTrip(mailVault(1)));
		expect(state.product).toBe('app');
		expect(state.masterKey).toBeUndefined();
		expect(state.keyPassword).toBe('');
		expect([...state.accountKeys.keys()].sort()).toEqual(identities.map(fingerprintHexOf).sort());
		expect(fingerprintHexOf(state.privateKey)).toBe(fingerprintHexOf(identities[1]));
		expect(state.keyVersion).toBe(2);
		expect(accountKeysByVersion(state).map(fingerprintHexOf)).toEqual([identities[1], identities[2], identities[0]].map(fingerprintHexOf));
	});

	it('does not pick a current key by sort order', async () => {
		for (const current of [0, 1, 2]) {
			const state = await productVaultState(ACCOUNT, EMAIL, roundTrip(mailVault(current)));
			expect(fingerprintHexOf(state.privateKey)).toBe(fingerprintHexOf(identities[current]));
		}
	});

	it('restores alias keys with what is known about them', async () => {
		const state = await productVaultState(ACCOUNT, EMAIL, roundTrip(mailVault(2)));
		const team = state.aliasKeys.get(fingerprintHexOf(aliases[0]));
		const desk = state.aliasKeys.get(fingerprintHexOf(aliases[1]));
		expect(team).toMatchObject({ aliasId: 'alias-team', addressId: 'addr-team', email: 'team@thelemail.test', keyVersion: 2 });
		expect(desk).toMatchObject({ aliasId: '', addressId: '', email: '', keyVersion: 1 });
		expect(state.aliasCurrent.get('alias-team')).toBe(fingerprintHexOf(aliases[0]));
	});

	it('keeps the search leaf and never a root or passphrase in the unlocked state', async () => {
		const vault = roundTrip(mailVault(2));
		const state = await productVaultState(ACCOUNT, EMAIL, vault);
		expect(state.searchLeaf).toEqual(leaf);
		expect(state.wrappedMasterKey).toBeUndefined();
		expect(Object.values(state).some((v) => v instanceof Uint8Array && v.length === 32 && v.every((b) => b === 9))).toBe(false);
		wipeProductVault(vault);
		expect(vault.root.every((b) => b === 0)).toBe(true);
		expect(state.searchLeaf).toEqual(leaf);
	});

	it('refuses a vault whose current key is missing', async () => {
		const vault = mailVault(1);
		vault.keys = vault.keys.filter((k) => k.keyId !== vault.currentKeyId);
		await expect(productVaultState(ACCOUNT, EMAIL, roundTrip(vault))).rejects.toBeInstanceOf(ProductKeysError);
	});

	it('refuses malformed payloads', () => {
		const good = JSON.parse(new TextDecoder().decode(encodeProductVault(mailVault(0))));
		const cases: Record<string, unknown> = {
			'unknown version': { ...good, v: 5 },
			'unknown product': { ...good, p: 'auth' },
			'short root': { ...good, r: btoa('short') },
			'empty material': { ...good, k: [{ ...good.k[0], m: '' }] },
			'zero epoch': { ...good, k: [{ ...good.k[0], e: 0 }] },
			'noncanonical key id': { ...good, k: [{ ...good.k[0], i: 'KEY' }] },
			'bad manifest hash': { ...good, n: { ...good.n, h: btoa('x') } }
		};
		for (const [name, payload] of Object.entries(cases)) {
			expect(() => decodeProductVault(JSON.stringify(payload)), name).toThrow(ProductKeysError);
		}
		expect(() => decodeProductVault('not json')).toThrow(ProductKeysError);
	});

	it('still reads a version 3 calendar vault', async () => {
		const calendar = await key('');
		const v3 = { p: 'calendar', r: btoa(String.fromCharCode(...new Uint8Array(32).fill(5))), k: [{ i: 'x', u: ENTRY.calendarIdentity, m: btoa(String.fromCharCode(...secretKeyBytes(calendar))) }] };
		const vault = decodeProductVault(JSON.stringify(v3));
		expect(vault.currentKeyId).toBeNull();
		const state = await productVaultState(ACCOUNT, EMAIL, vault);
		expect(state.product).toBe('calendar');
		expect(fingerprintHexOf(state.privateKey)).toBe(fingerprintHexOf(calendar));
		expect(state.keyPassword).toBe(`calendar:${ACCOUNT}`);
		expect(state.accountKeys.size).toBe(0);
		expect(state.searchLeaf).toBeUndefined();
	});
});
