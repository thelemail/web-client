// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import type { CustodyJournal } from '$core/custody/journal';
import type { VaultRecord } from '../idb';
import { ecdhSecret, sealHandoff } from '../handoff/envelope';
import type { Grant } from '../handoff/wire';
import { parseEnvelope } from '../handoff/wire';
import type { ConversionInput, ConversionOutput } from '../productkeys/convert';
import { buildConversion, deriveSearchLeaf, stripUserIds } from '../productkeys/convert';
import { b64encode, keyId, sha256 } from '../productkeys/encoding';
import { headHash, parseHeadV2 } from '../productkeys/head';
import { fingerprintBytes } from '../productkeys/pgp';
import type { Availability } from '../productkeys/productBundle';
import { openAuthority, openRootDescriptor } from '../productkeys/secretBundle';
import type { AdoptHandoffArgs } from '../protocol';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));

const legacyDb = vi.hoisted(() => ({ records: new Map<string, unknown>() }));
const custodyDb = vi.hoisted(() => ({ journals: new Map<string, unknown>(), vaults: new Map<string, unknown>() }));
const handoffDb = vi.hoisted(() => ({ staged: new Map<string, unknown>(), unstorable: false }));

vi.mock('../idb', () => ({
	getVault: async (id: string) => legacyDb.records.get(id) ?? null,
	getAllVaults: async () => [...legacyDb.records.values()],
	putVault: async (rec: VaultRecord) => {
		legacyDb.records.set(rec.accountId, rec);
	},
	deleteVault: async (id: string) => {
		legacyDb.records.delete(id);
	},
	clearAllVaults: async () => legacyDb.records.clear()
}));

vi.mock('$core/custody/store', () => ({
	getJournal: async (id: string) => custodyDb.journals.get(id) ?? null,
	getAllJournals: async () => [...custodyDb.journals.values()],
	putJournal: async (j: CustodyJournal) => {
		custodyDb.journals.set(j.accountId, j);
	},
	getAllCustodyVaults: async () => [...custodyDb.vaults.values()],
	commitCustody: async (j: CustodyJournal, record: VaultRecord) => {
		custodyDb.vaults.set(j.accountId, record);
		custodyDb.journals.set(j.accountId, j);
	},
	forgetCustody: async () => undefined,
	forgetAllCustody: async () => undefined
}));

vi.mock('../handoff/store', () => ({
	putStaged: async (s: { requestId: string }) => {
		if (handoffDb.unstorable) throw new DOMException('clone', 'DataCloneError');
		handoffDb.staged.set(s.requestId, s);
	},
	getStaged: async (id: string) => handoffDb.staged.get(id) ?? null,
	deleteStaged: async (id: string) => {
		handoffDb.staged.delete(id);
	}
}));

const { handleAdoptHandoff, handleCommitHandoff, handleDiscardHandoff } = await import('./handoff-ops');
const { handleTryRestoreFromPersistent } = await import('./vault-persist');
const { handleOpenIndex, handleSealIndex } = await import('./content-ops');
const state = await import('./state');
const gate = await import('./gate');

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const ALIAS = '8b9c0d1e-2f3a-4b4c-9d6e-7f8091a2b3c4';
const EMAIL = 'calloway@thelemail.test';
const KEY_PASSWORD = 'cGFzc3BocmFzZS1mb3ItdGVzdHMtb25seQ==';
const ORIGIN = 'https://app.thelemail.test';
const ISSUER = 'https://auth.thelemail.test';

let out: ConversionOutput;
let amk: Uint8Array;
let keys: openpgp.PrivateKey[];
let alias: openpgp.PrivateKey;

function fp(k: openpgp.Key): string {
	return state.fingerprintHexOf(k);
}

async function adoption(serverHalf: string | null): Promise<AdoptHandoffArgs> {
	const head = parseHeadV2(out.activation.head);
	const d = head.productDescriptors.find((x) => x.product === 'app')!;
	const rootBundle = out.secretBundles.find((b) => b.bundleId === d.rootBundleId)!;
	const root = await openRootDescriptor(amk, rootBundle.bundle, { accountId: ACCOUNT, amkEpoch: head.amkEpoch, bundleId: d.rootBundleId, revision: d.rootBundleRevision });
	const authorityBundle = out.secretBundles.find((b) => b.kind === 'auth-authority')!;
	const authority = await openAuthority(amk, authorityBundle.bundle, { accountId: ACCOUNT, amkEpoch: head.amkEpoch, bundleId: authorityBundle.bundleId, revision: 1 });
	const signer = await openpgp.readPrivateKey({ binaryKey: authority.secretKey });
	const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
	const receiverPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
	const stateHash = crypto.getRandomValues(new Uint8Array(32));
	const issuedAt = Math.floor(Date.now() / 1000);
	const requestId = crypto.randomUUID();
	const destinationSessionId = crypto.randomUUID();
	const grant: Grant = {
		version: 1,
		issuer: ISSUER,
		requestId,
		accountId: ACCOUNT,
		clientId: 'web-mail',
		product: 'app',
		origin: ORIGIN,
		callback: `${ORIGIN}/auth/callback`,
		receiverKeyDigest: await sha256(receiverPublicKey),
		stateHash,
		sourceSessionId: crypto.randomUUID(),
		destinationSessionId,
		credentialGeneration: 1,
		sessionEpoch: 4,
		authorityEpoch: head.authorityEpoch,
		productKeyEpoch: d.productKeyEpoch,
		manifestId: d.identityManifestId,
		manifestRevision: d.identityManifestRevision,
		manifestHash: d.identityManifestHash,
		accountHeadRevision: head.stateRevision,
		accountHeadHash: await headHash(out.activation.head),
		issuedAt,
		redeemBy: issuedAt + 60,
		adoptBy: issuedAt + 360
	};
	const envelope = await sealHandoff(grant, root.productRoot, receiverPublicKey, signer);
	const parsed = await parseEnvelope(envelope);
	const manifest = out.identityManifests.find((m) => m.product === 'app')!;
	return {
		accountId: ACCOUNT,
		requestId,
		product: 'app',
		email: EMAIL,
		envelope,
		sharedSecret: await ecdhSecret(receiver.privateKey, parsed.context.senderPublicKey),
		expect: { issuer: ISSUER, origin: ORIGIN, clientId: 'web-mail', callback: `${ORIGIN}/auth/callback`, destinationSessionId, receiverKeyDigest: grant.receiverKeyDigest, stateHash },
		keys: {
			head: { raw: out.activation.head, authority: out.activation.authoritySignature },
			authorityKey: out.activation.authorityPublicKey,
			identityManifest: { record: manifest.record, signature: manifest.signature },
			bundles: out.productBundles.filter((b) => b.product === 'app').map((b) => ({ bundleId: b.bundleId, revision: b.revision, bundle: b.bundle }))
		},
		serverHalf
	};
}

beforeAll(async () => {
	const gen = async (n: number) =>
		(await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: `calloway${n}@thelemail.test` }], passphrase: KEY_PASSWORD, format: 'object', config: { v6Keys: true } })).privateKey;
	const locked = [await gen(1), await gen(2), await gen(3)];
	keys = await Promise.all(locked.map((privateKey) => openpgp.decryptKey({ privateKey, passphrase: KEY_PASSWORD })));
	({ privateKey: alias } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'team@thelemail.test' }], format: 'object', config: { v6Keys: true } }));
	const wrapped = (await openpgp.encrypt({ message: await openpgp.createMessage({ text: alias.armor() }), encryptionKeys: keys[1].toPublic() })) as string;
	amk = crypto.getRandomValues(new Uint8Array(32));
	const history = await Promise.all(
		locked.map(async (k, i) => {
			const stripped = stripUserIds(k);
			return { keyId: keyId(ACCOUNT, fingerprintBytes(k)), keyEpoch: i + 1, profileId: 'mail-classic-v1', publicKeyHash: await sha256(stripped), publicKeyBytes: stripped };
		})
	);
	const input: ConversionInput = {
		accountId: ACCOUNT,
		amk,
		keyPassword: KEY_PASSWORD,
		scope: { stateRevision: 0, activeKeyEpoch: 3, activeGeneration: 1, authEpoch: 2, recoveryEpoch: 1, amkEpoch: 1, minimumWriteProfile: null, historyEventCount: 5, keyHistoryRoot: new Uint8Array(32).fill(7) },
		sessionEpoch: 4,
		previousHeadHash: null,
		credentialHashes: [new Uint8Array(32).fill(1)],
		slotHashes: [new Uint8Array(32).fill(2)],
		history,
		availability: new Map<string, Availability>(history.map((h) => [h.keyId, 'available'])),
		accountKeys: locked.map((k, i) => ({ armoredEncrypted: k.armor(), isCurrent: i === 1 })),
		aliasKeys: [{ aliasId: ALIAS, keyVersion: 1, wrappedPrivateKey: wrapped }]
	};
	out = await buildConversion(input);
}, 120_000);

beforeEach(() => {
	legacyDb.records.clear();
	custodyDb.journals.clear();
	custodyDb.vaults.clear();
	handoffDb.staged.clear();
	handoffDb.unstorable = false;
	state.vaults.clear();
	state.cachedRecords.clear();
	state.productAccounts.clear();
	state.indexKeys.clear();
});

describe('mail adopts a handoff from the auth origin', () => {
	it('opens a vault with every identity key and the committed current one', async () => {
		legacyDb.records.set(ACCOUNT, { accountId: ACCOUNT, email: EMAIL, authScheme: 'opaque_v1', wrappedMasterKey: 'd3JhcHBlZA==', armoredEncryptedPrivateKey: 'legacy', updatedAt: 1 });
		const args = await adoption(b64encode(crypto.getRandomValues(new Uint8Array(32))));
		const serverHalf = args.serverHalf!;
		expect(gate.commandAllowed('adoptHandoff', args)).toBe(true);
		const adopted = await handleAdoptHandoff(args);
		expect(adopted).toMatchObject({ ok: true, durable: true });
		expect(state.vaults.has(ACCOUNT)).toBe(false);
		expect(custodyDb.vaults.size).toBe(0);

		expect(await handleCommitHandoff({ accountId: ACCOUNT, requestId: args.requestId })).toEqual({ ok: true });

		const v = state.vaults.get(ACCOUNT)!;
		expect(v.product).toBe('app');
		expect(v.masterKey).toBeUndefined();
		expect(v.keyPassword).toBe('');
		expect([...v.accountKeys.keys()].sort()).toEqual(keys.map(fp).sort());
		expect(fp(v.privateKey)).toBe(fp(keys[1]));
		expect(v.keyVersion).toBe(2);
		expect(v.aliasKeys.has(fp(alias))).toBe(true);
		expect(v.searchLeaf).toEqual(await deriveSearchLeaf(KEY_PASSWORD, ACCOUNT));
		const sealed = await handleSealIndex({ accountId: ACCOUNT, plaintext: new Uint8Array([1, 2, 3]) });
		expect(sealed.ok && (await handleOpenIndex({ accountId: ACCOUNT, iv: sealed.iv, ciphertext: sealed.ciphertext })).ok).toBe(true);

		expect(legacyDb.records.has(ACCOUNT)).toBe(false);
		expect((custodyDb.vaults.get(ACCOUNT) as VaultRecord).wrapPayloadVersion).toBe(4);
		expect(custodyDb.journals.get(ACCOUNT)).toMatchObject({ state: 'complete', exchange: null, target: { kind: 'committed' } });
		expect(handoffDb.staged.size).toBe(0);
		expect(gate.vaultModeOf(ACCOUNT)).toBe('mail');
		expect(gate.commandAllowed('prepareKeyRotation', { accountId: ACCOUNT })).toBe(false);

		state.handleLock({ accountId: ACCOUNT });
		expect(await handleTryRestoreFromPersistent({ accountId: ACCOUNT, serverHalf })).toMatchObject({ ok: true });
		const restored = state.vaults.get(ACCOUNT)!;
		expect([...restored.accountKeys.keys()].sort()).toEqual(keys.map(fp).sort());
		expect(fp(restored.privateKey)).toBe(fp(keys[1]));
		expect(restored.aliasKeys.has(fp(alias))).toBe(true);
	});

	it('completes a migration that was waiting for its first auth visit', async () => {
		const waiting: CustodyJournal = { accountId: ACCOUNT, schema: 1, migrationId: 'op-earlier', state: 'auth-ready', target: { kind: 'candidate', digest: 'ZA==' }, exchange: null, sessionId: 'child', startedAt: 5, updatedAt: 6, failure: null };
		custodyDb.journals.set(ACCOUNT, waiting);
		state.productAccounts.add(ACCOUNT);
		const args = await adoption(null);
		expect(await handleAdoptHandoff(args)).toMatchObject({ ok: true, durable: false });
		expect(await handleCommitHandoff({ accountId: ACCOUNT, requestId: args.requestId })).toEqual({ ok: true });
		expect(custodyDb.journals.get(ACCOUNT)).toMatchObject({ state: 'complete', migrationId: 'op-earlier', startedAt: 5, sessionId: 'child' });
		const kept = custodyDb.vaults.get(ACCOUNT) as VaultRecord;
		expect(kept.wrappedPrivateKey).toBeUndefined();
		expect(kept.email).toBe(EMAIL);
		expect(state.vaults.get(ACCOUNT)?.product).toBe('app');
	});

	it('falls back to a memory-only vault when the browser cannot store the local key', async () => {
		handoffDb.unstorable = true;
		const args = await adoption(b64encode(crypto.getRandomValues(new Uint8Array(32))));
		expect(await handleAdoptHandoff(args)).toMatchObject({ ok: true, durable: false });
		expect(await handleCommitHandoff({ accountId: ACCOUNT, requestId: args.requestId })).toEqual({ ok: true });
		expect((custodyDb.vaults.get(ACCOUNT) as VaultRecord).wrappedPrivateKey).toBeUndefined();
	});

	it('leaves everything in place when the adoption is discarded or was never made', async () => {
		legacyDb.records.set(ACCOUNT, { accountId: ACCOUNT, email: EMAIL, authScheme: 'opaque_v1', armoredEncryptedPrivateKey: 'legacy', updatedAt: 1 });
		const args = await adoption(b64encode(crypto.getRandomValues(new Uint8Array(32))));
		await handleAdoptHandoff(args);
		await handleDiscardHandoff({ accountId: ACCOUNT, requestId: args.requestId });
		expect(await handleCommitHandoff({ accountId: ACCOUNT, requestId: args.requestId })).toEqual({ ok: false, code: 'missing' });
		expect(legacyDb.records.has(ACCOUNT)).toBe(true);
		expect(custodyDb.vaults.size + custodyDb.journals.size + handoffDb.staged.size).toBe(0);
		expect(state.vaults.has(ACCOUNT)).toBe(false);
	});

	it('refuses an envelope bound to another request', async () => {
		const args = await adoption(null);
		const res = await handleAdoptHandoff({ ...args, expect: { ...args.expect, destinationSessionId: crypto.randomUUID() } });
		expect(res).toMatchObject({ ok: false, code: 'invalid' });
	});
});
