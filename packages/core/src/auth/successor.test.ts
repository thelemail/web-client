// @vitest-environment node
import * as openpgp from 'openpgp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
	getCryptoState: vi.fn(),
	getProductCandidate: vi.fn(),
	putSecretBundle: vi.fn(),
	putProductBundle: vi.fn(),
	putProductManifest: vi.fn(),
	activateCryptoHead: vi.fn(),
	getProductBundle: vi.fn(),
	getProductKeys: vi.fn(),
	getSecretBundle: vi.fn()
}));
const keystore = vi.hoisted(() => ({ prepareProductKeys: vi.fn(), prepareSuccessorHead: vi.fn(), readProductKeys: vi.fn() }));
const aliases = vi.hoisted(() => ({ listMyAliasKeys: vi.fn() }));
vi.mock('$core/api/productKeys', () => api);
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));
vi.mock('$core/api/me', () => ({ listMyKeys: vi.fn(async () => ({ keys: [] })) }));
vi.mock('$core/api/aliases', () => aliases);

import type { CryptoStateResponse } from '$core/api/productKeys';
import type { ConversionOutput } from '$core/keystore/productkeys/convert';
import { buildConversion, stripUserIds } from '$core/keystore/productkeys/convert';
import { b64encode, keyId, sha256 } from '$core/keystore/productkeys/encoding';
import { fingerprintBytes } from '$core/keystore/productkeys/pgp';
import { ensureConverted, headDrift } from './product-keys';

const accountId = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const aliasId = '8b9c0d1e-2f3a-4b4c-9d6e-7f8091a2b3c4';
const keyPassword = 'cGFzc3BocmFzZS1mb3ItdGVzdHMtb25seQ==';
const credential = new Uint8Array(32).fill(1);
const slot = new Uint8Array(32).fill(2);
const historyRoot = new Uint8Array(32).fill(7);

let out: ConversionOutput;
let grant: { aliasAccountId: string; keyVersion: number; wrappedPrivateKey: string };

beforeAll(async () => {
	const { privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'calloway@thelemail.test' }], passphrase: keyPassword, format: 'object', config: { v6Keys: true } });
	const stripped = stripUserIds(privateKey);
	const id = keyId(accountId, fingerprintBytes(privateKey));
	const current = await openpgp.decryptKey({ privateKey, passphrase: keyPassword });
	const { privateKey: alias } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'team@thelemail.test' }], format: 'object', config: { v6Keys: true } });
	const wrapped = (await openpgp.encrypt({ message: await openpgp.createMessage({ text: alias.armor() }), encryptionKeys: current.toPublic() })) as string;
	grant = { aliasAccountId: aliasId, keyVersion: 1, wrappedPrivateKey: btoa(wrapped) };
	out = await buildConversion({
		accountId,
		amk: crypto.getRandomValues(new Uint8Array(32)),
		keyPassword,
		scope: { stateRevision: 0, activeKeyEpoch: 1, activeGeneration: 1, authEpoch: 2, recoveryEpoch: 1, amkEpoch: 1, minimumWriteProfile: null, historyEventCount: 1, keyHistoryRoot: historyRoot },
		sessionEpoch: 4,
		previousHeadHash: null,
		credentialHashes: [credential],
		slotHashes: [slot],
		history: [{ keyId: id, keyEpoch: 1, profileId: 'mail-classic-v1', publicKeyHash: await sha256(stripped), publicKeyBytes: stripped }],
		availability: new Map([[id, 'available']]),
		accountKeys: [{ armoredEncrypted: privateKey.armor(), isCurrent: true }],
		aliasKeys: [{ aliasId, keyVersion: 1, wrappedPrivateKey: wrapped }]
	});
});

function state(over: { scope?: Partial<CryptoStateResponse['scope']>; sessionEpoch?: number; credentials?: CryptoStateResponse['credentials'] } = {}): CryptoStateResponse {
	return {
		scope: { scopeType: 'account', scopeId: accountId, stateRevision: 1, activeKeyEpoch: 1, activeGeneration: 1, authEpoch: 2, recoveryEpoch: 1, amkEpoch: 1, minimumWriteProfile: null, historyEventCount: 1, keyHistoryRoot: b64encode(historyRoot), ...over.scope },
		sessionEpoch: over.sessionEpoch ?? 4,
		credentialGeneration: 1,
		head: { version: 2, stateRevision: 1, head: b64encode(out.activation.head), headHash: '', previousHeadHash: null, authoritySignature: '', legacySignature: '', transitionSignature: null, mac: b64encode(out.activation.mac) },
		credentials: over.credentials ?? [{ credentialId: 'c', method: 'password', state: 'active', recordHash: b64encode(credential) }],
		slots: [{ slotId: 's', kind: 'password', state: 'active', wrapperHash: b64encode(slot) }],
		bundles: [],
		keys: [],
		history: { start: 0, end: 0, predecessor: '', events: [], nextCursor: null },
		features: { productKeys: true }
	};
}

const appManifest = () => out.identityManifests.find((m) => m.product === 'app')!.record;

describe('headDrift', () => {
	it('finds no drift right after conversion', () => {
		expect(headDrift(state(), out.activation.head, appManifest(), [grant])).toBe(false);
	});

	it.each([
		['a password change', { scope: { authEpoch: 3 }, credentials: [{ credentialId: 'c', method: 'password', state: 'active', recordHash: b64encode(new Uint8Array(32).fill(9)) }] }],
		['sign-out everywhere', { sessionEpoch: 5 }],
		['a recovery change', { scope: { recoveryEpoch: 2 } }],
		['a mail key rotation', { scope: { activeKeyEpoch: 2, historyEventCount: 3 } }]
	])('notices %s', (_, over) => {
		expect(headDrift(state(over), out.activation.head, appManifest(), [grant])).toBe(true);
	});

	it('notices a new or rotated alias key', () => {
		expect(headDrift(state(), out.activation.head, appManifest(), [grant, { ...grant, keyVersion: 1 }])).toBe(true);
		expect(headDrift(state(), out.activation.head, appManifest(), [{ ...grant, keyVersion: 2 }])).toBe(true);
		expect(headDrift(state(), out.activation.head, appManifest(), [])).toBe(true);
	});
});

describe('ensureConverted with an active head', () => {
	beforeEach(() => {
		for (const fn of [...Object.values(api), ...Object.values(keystore), aliases.listMyAliasKeys]) fn.mockReset();
		aliases.listMyAliasKeys.mockResolvedValue({ keys: [grant] });
		api.getProductKeys.mockImplementation(async (_: string, product: 'app' | 'calendar') => {
			const m = out.identityManifests.find((x) => x.product === product)!;
			const d = out.activation.delegations[product === 'app' ? 0 : 1];
			return {
				authorityKey: { publicKey: b64encode(out.activation.authorityPublicKey) },
				identityManifest: { record: b64encode(m.record), signature: b64encode(m.signature) },
				delegation: { record: b64encode(d.record), signature: b64encode(d.signature), signingPublicKey: b64encode(d.signingPublicKey) },
				dataManifest: []
			};
		});
		api.getProductBundle.mockImplementation(async (_: string, __: string, bundleId: string) => ({ bundle: b64encode(out.productBundles.find((b) => b.bundleId === bundleId)!.bundle) }));
	});

	it('does not touch the vault while nothing drifted', async () => {
		api.getCryptoState.mockResolvedValue(state());
		expect(await ensureConverted(accountId)).toBe(true);
		expect(keystore.prepareSuccessorHead).not.toHaveBeenCalled();
	});

	it('activates a successor after a password change without a mail-key signature', async () => {
		api.getCryptoState.mockResolvedValue(state({ scope: { authEpoch: 3 } }));
		keystore.prepareSuccessorHead.mockResolvedValue({
			ok: true,
			output: {
				secretBundles: [],
				productBundles: [],
				identityManifests: [],
				dataManifests: [],
				activation: { head: new Uint8Array([1]), mac: new Uint8Array([2]), authoritySignature: new Uint8Array([3]), delegations: [] }
			}
		});
		expect(await ensureConverted(accountId)).toBe(true);
		expect(keystore.prepareSuccessorHead.mock.calls[0][0]).toMatchObject({ accountId, previous: { raw: out.activation.head } });
		expect(api.activateCryptoHead).toHaveBeenCalledWith(accountId, expect.objectContaining({ legacySignature: null, transitionSignature: null, authorityPublicKey: null }));
	});

	it('keeps the handoff open when the successor cannot be built', async () => {
		api.getCryptoState.mockResolvedValue(state({ scope: { authEpoch: 3 } }));
		keystore.prepareSuccessorHead.mockResolvedValue({ ok: false, code: 'invalid', message: 'nope' });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await ensureConverted(accountId)).toBe(true);
		expect(api.activateCryptoHead).not.toHaveBeenCalled();
	});
});
