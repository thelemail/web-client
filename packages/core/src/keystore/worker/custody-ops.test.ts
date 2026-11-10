// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import type { CustodyJournal } from '$core/custody/journal';
import type { StagedCustodyVault } from '$core/custody/store';
import type { VaultRecord } from '../idb';
import { deriveSearchLeaf, stripUserIds } from '../productkeys/convert';
import { b64encode, keyId, sha256 } from '../productkeys/encoding';
import { candidateHash } from '../productkeys/candidate';
import { fingerprintBytes } from '../productkeys/pgp';
import type { CustodyPrepareArgs } from '../protocol';
import type { MailCandidateUpload, StoredCandidate } from '../productkeys/mailCandidate';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));

const legacyDb = vi.hoisted(() => ({ records: new Map<string, unknown>() }));
const custodyDb = vi.hoisted(() => ({
	journals: new Map<string, unknown>(),
	vaults: new Map<string, unknown>(),
	staged: new Map<string, unknown>(),
	failPutStaged: null as (() => unknown) | null,
	failCommit: null as (() => unknown) | null,
	corruptReadBack: false
}));

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
	getCustodyVault: async (id: string) => custodyDb.vaults.get(id) ?? null,
	getAllCustodyVaults: async () => [...custodyDb.vaults.values()],
	putStagedVault: async (s: StagedCustodyVault) => {
		if (custodyDb.failPutStaged) throw custodyDb.failPutStaged();
		custodyDb.staged.set(s.migrationId, s);
	},
	getStagedVault: async (id: string) => {
		const s = custodyDb.staged.get(id) as StagedCustodyVault | undefined;
		if (!s) return null;
		if (!custodyDb.corruptReadBack) return s;
		const wrapped = s.record.wrappedPrivateKey!.slice();
		wrapped[0] ^= 1;
		return { ...s, record: { ...s.record, wrappedPrivateKey: wrapped } };
	},
	deleteStagedVault: async (id: string) => {
		custodyDb.staged.delete(id);
	},
	commitCustody: async (j: CustodyJournal, staged: StagedCustodyVault | null) => {
		if (custodyDb.failCommit) throw custodyDb.failCommit();
		if (staged) custodyDb.vaults.set(j.accountId, staged.record);
		else custodyDb.vaults.delete(j.accountId);
		custodyDb.staged.delete(j.migrationId);
		custodyDb.journals.set(j.accountId, j);
	},
	forgetCustody: async (id: string) => {
		custodyDb.journals.delete(id);
		custodyDb.vaults.delete(id);
	},
	forgetAllCustody: async () => {
		custodyDb.journals.clear();
		custodyDb.vaults.clear();
		custodyDb.staged.clear();
	}
}));

type State = typeof import('./state');
type Ops = typeof import('./custody-ops');
type Persist = typeof import('./vault-persist');
type Content = typeof import('./content-ops');
type Gate = typeof import('./gate');

let state: State;
let ops: Ops;
let persist: Persist;
let content: Content;
let gate: Gate;

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const EMAIL = 'calloway@thelemail.test';
const ALIAS_ACCOUNT = '8b9c0d1e-2f3a-4b4c-9d6e-7f8091a2b3c4';
const KEY_PASSWORD = 'cGFzc3BocmFzZS1mb3ItdGVzdHMtb25seQ==';
const MIGRATION = 'c1a0b2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

let locked: openpgp.PrivateKey[];
let unlocked: openpgp.PrivateKey[];
let alias: openpgp.PrivateKey;
let wrappedAlias: string;
let amk: Uint8Array;
let prepareArgs: Omit<CustodyPrepareArgs, 'migrationId'>;

function fp(key: openpgp.Key): string {
	return state.fingerprintHexOf(key);
}

function legacyRecord(): VaultRecord {
	return {
		accountId: ACCOUNT,
		email: EMAIL,
		authScheme: 'opaque_v1',
		wrappedMasterKey: 'd3JhcHBlZA==',
		armoredEncryptedPrivateKey: locked[1].armor(),
		keyVersion: 2,
		updatedAt: 1
	};
}

function installLegacy(extraKey?: openpgp.PrivateKey): void {
	const accountKeys = new Map(
		unlocked.map((k, i) => [fp(k), { keyVersion: i + 1, fingerprintHex: fp(k), privateKey: k, armoredEncrypted: locked[i].armor() }])
	);
	if (extraKey) accountKeys.set(fp(extraKey), { keyVersion: 3, fingerprintHex: fp(extraKey), privateKey: extraKey, armoredEncrypted: '' });
	const v: import('./state').VaultState = {
		accountId: ACCOUNT,
		email: EMAIL,
		authScheme: 'opaque_v1',
		masterKey: amk.slice(),
		armoredEncryptedPrivateKey: locked[1].armor(),
		privateKey: unlocked[1],
		keyPassword: KEY_PASSWORD,
		accountKeys,
		keyVersion: 2,
		aliasKeys: new Map([[fp(alias), { aliasId: 'alias-team', addressId: 'addr-team', email: 'team@thelemail.test', keyVersion: 1, fingerprintHex: fp(alias), privateKey: alias }]]),
		aliasCurrent: new Map([['alias-team', fp(alias)]])
	};
	state.vaults.set(ACCOUNT, v);
	state.cachedRecords.set(ACCOUNT, legacyRecord());
	legacyDb.records.set(ACCOUNT, legacyRecord());
}

function stored(upload: MailCandidateUpload): StoredCandidate {
	return { record: upload.record, rootBundle: upload.rootBundle, bundles: upload.bundles.map((b) => ({ bundleId: b.bundleId, revision: b.revision, bundle: b.bundle })) };
}

function journal(s: CustodyJournal['state']): CustodyJournal {
	return { accountId: ACCOUNT, schema: 1, migrationId: MIGRATION, state: s, target: { kind: 'candidate', digest: 'ZA==' }, exchange: null, sessionId: 'child', startedAt: 1, updatedAt: 1, failure: null };
}

async function prepared(): Promise<MailCandidateUpload> {
	const res = await ops.handleCustodyPrepare({ ...prepareArgs, migrationId: MIGRATION });
	if (!res.ok) throw new Error(`prepare refused: ${res.code} ${res.message ?? ''}`);
	return res.upload;
}

async function adopted(upload?: MailCandidateUpload): Promise<MailCandidateUpload> {
	const u = upload ?? (await prepared());
	const res = await ops.handleCustodyAdopt({ accountId: ACCOUNT, migrationId: MIGRATION, source: { kind: 'candidate', stored: stored(u) } });
	if (!res.ok) throw new Error(`adopt refused: ${res.code} ${res.message ?? ''}`);
	return u;
}

function half(): string {
	return b64encode(crypto.getRandomValues(new Uint8Array(32)));
}

async function load(): Promise<void> {
	vi.resetModules();
	state = await import('./state');
	await state.restorePromise;
	ops = await import('./custody-ops');
	persist = await import('./vault-persist');
	content = await import('./content-ops');
	gate = await import('./gate');
}

beforeAll(async () => {
	vi.stubGlobal('indexedDB', {});
	const gen = async (n: number) =>
		(await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: `calloway${n}@thelemail.test` }], passphrase: KEY_PASSWORD, format: 'object', config: { v6Keys: true } })).privateKey;
	locked = [await gen(1), await gen(2)];
	unlocked = await Promise.all(locked.map((privateKey) => openpgp.decryptKey({ privateKey, passphrase: KEY_PASSWORD })));
	({ privateKey: alias } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'team@thelemail.test' }], format: 'object', config: { v6Keys: true } }));
	wrappedAlias = (await openpgp.encrypt({ message: await openpgp.createMessage({ text: alias.armor() }), encryptionKeys: unlocked[1].toPublic() })) as string;
	amk = crypto.getRandomValues(new Uint8Array(32));
	const historyEvents = await Promise.all(
		locked.map(async (k, i) => {
			const stripped = stripUserIds(k);
			return new TextEncoder().encode(
				JSON.stringify({
					eventType: 'introduced',
					keyId: keyId(ACCOUNT, fingerprintBytes(k)),
					keyEpoch: i + 1,
					profileId: 'mail-classic-v1',
					publicKeyHash: b64encode(await sha256(stripped)),
					eventPayload: { publicKeyBytes: b64encode(stripped) }
				})
			);
		})
	);
	prepareArgs = {
		accountId: ACCOUNT,
		amkEpoch: 1,
		historyEvents,
		availability: locked.map((k) => ({ keyId: keyId(ACCOUNT, fingerprintBytes(k)), state: 'available' as const })),
		accountKeys: locked.map((k, i) => ({ armoredEncrypted: k.armor(), isCurrent: i === 1 })),
		aliasKeys: [{ aliasId: ALIAS_ACCOUNT, keyVersion: 1, wrappedPrivateKey: wrappedAlias }]
	};
}, 120_000);

beforeEach(async () => {
	legacyDb.records.clear();
	custodyDb.journals.clear();
	custodyDb.vaults.clear();
	custodyDb.staged.clear();
	custodyDb.failPutStaged = null;
	custodyDb.failCommit = null;
	custodyDb.corruptReadBack = false;
	await load();
	installLegacy();
});

describe('mail custody in the worker', () => {
	it('turns an unlocked legacy vault into a mail-only vault with the same keys', async () => {
		const sealedBefore = await content.handleSealIndex({ accountId: ACCOUNT, plaintext: new TextEncoder().encode('row') });
		if (!sealedBefore.ok) throw new Error('seal failed');
		const upload = await adopted();
		const serverHalf = half();
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf })).toEqual({ ok: true, durable: true });
		expect(state.vaults.get(ACCOUNT)?.masterKey).toBeDefined();
		expect(custodyDb.vaults.size).toBe(0);
		expect(gate.vaultModeOf(ACCOUNT)).toBe('account');

		expect(await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') })).toEqual({ ok: true });

		const v = state.vaults.get(ACCOUNT)!;
		expect(v.product).toBe('app');
		expect(v.masterKey).toBeUndefined();
		expect(v.keyPassword).toBe('');
		expect([...v.accountKeys.keys()].sort()).toEqual(unlocked.map(fp).sort());
		expect(fp(v.privateKey)).toBe(fp(unlocked[1]));
		expect(v.keyVersion).toBe(2);
		expect(v.aliasKeys.get(fp(alias))).toMatchObject({ aliasId: 'alias-team', addressId: 'addr-team', email: 'team@thelemail.test' });
		expect(v.searchLeaf).toEqual(await deriveSearchLeaf(KEY_PASSWORD, ACCOUNT));
		const opened = await content.handleOpenIndex({ accountId: ACCOUNT, iv: sealedBefore.iv, ciphertext: sealedBefore.ciphertext });
		expect(opened.ok && new TextDecoder().decode(opened.plaintext)).toBe('row');

		expect(gate.vaultModeOf(ACCOUNT)).toBe('mail');
		expect(gate.commandAllowed('prepareKeyRotation', { accountId: ACCOUNT })).toBe(false);
		expect(gate.commandAllowed('decrypt', { accountId: ACCOUNT })).toBe(true);
		expect((await state.handleStatus()).accounts).toEqual([{ accountId: ACCOUNT, email: EMAIL, unlocked: true, hasPersistent: true, authScheme: 'opaque_v1', mailOnly: true }]);
		expect(custodyDb.vaults.has(ACCOUNT)).toBe(true);
		expect(custodyDb.staged.size).toBe(0);
		expect((custodyDb.journals.get(ACCOUNT) as CustodyJournal).state).toBe('mail-committed');
		expect(legacyDb.records.has(ACCOUNT)).toBe(true);

		expect(await ops.handleCustodyRetire({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('legacy-retired-local') })).toEqual({ ok: true });
		expect(legacyDb.records.has(ACCOUNT)).toBe(false);
		expect((custodyDb.journals.get(ACCOUNT) as CustodyJournal).state).toBe('legacy-retired-local');

		state.handleLock({ accountId: ACCOUNT });
		expect(await persist.handleTryRestoreFromPersistent({ accountId: ACCOUNT, serverHalf: half() })).toEqual({ ok: false, reason: 'unwrap_failed' });
		expect(custodyDb.vaults.has(ACCOUNT)).toBe(true);
		expect(await persist.handleTryRestoreFromPersistent({ accountId: ACCOUNT, serverHalf })).toMatchObject({ ok: true, accountId: ACCOUNT });
		const restored = state.vaults.get(ACCOUNT)!;
		expect(restored.product).toBe('app');
		expect(restored.masterKey).toBeUndefined();
		expect([...restored.accountKeys.keys()].sort()).toEqual(unlocked.map(fp).sort());
		expect(restored.aliasKeys.get(fp(alias))?.aliasId).toBe('alias-team');
		expect(await candidateHash(upload.record)).toHaveLength(32);
	});

	it('keeps nothing durable for a session that was not remembered', async () => {
		await adopted();
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: null })).toEqual({ ok: true, durable: false });
		expect(custodyDb.staged.size).toBe(0);
		expect(await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') })).toEqual({ ok: true });
		expect(custodyDb.vaults.size).toBe(0);
		expect(state.vaults.get(ACCOUNT)?.product).toBe('app');
		await ops.handleCustodyRetire({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('legacy-retired-local') });
		state.handleLock({ accountId: ACCOUNT });
		expect(await persist.handleTryRestoreFromPersistent({ accountId: ACCOUNT, serverHalf: half() })).toEqual({ ok: false, reason: 'no_persistent' });
		expect(gate.vaultModeOf(ACCOUNT)).toBe('mail');
	});

	it('leaves the legacy vault usable when the staged write fails for lack of space', async () => {
		await adopted();
		custodyDb.failPutStaged = () => new DOMException('quota', 'QuotaExceededError');
		await expect(ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() })).rejects.toMatchObject({ name: 'QuotaExceededError' });
		expect(state.vaults.get(ACCOUNT)?.masterKey).toBeDefined();
		expect(legacyDb.records.has(ACCOUNT)).toBe(true);
		expect(custodyDb.staged.size + custodyDb.vaults.size + custodyDb.journals.size).toBe(0);
		expect(await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') })).toEqual({ ok: false, code: 'missing' });

		custodyDb.failPutStaged = null;
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() })).toEqual({ ok: true, durable: true });
	});

	it('falls back to memory when the browser cannot store the local key', async () => {
		await adopted();
		custodyDb.failPutStaged = () => new DOMException('clone', 'DataCloneError');
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() })).toEqual({ ok: true, durable: false });
	});

	it('refuses to commit a staged vault that does not read back', async () => {
		await adopted();
		custodyDb.corruptReadBack = true;
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() })).toMatchObject({ ok: false, code: 'invalid' });
		expect(custodyDb.staged.size).toBe(0);
		expect(await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') })).toEqual({ ok: false, code: 'missing' });
		expect(state.vaults.get(ACCOUNT)?.masterKey).toBeDefined();
	});

	it('stays legacy when the commit transaction fails and commits on retry', async () => {
		await adopted();
		await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() });
		custodyDb.failCommit = () => new DOMException('abort', 'AbortError');
		await expect(ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') })).rejects.toMatchObject({ name: 'AbortError' });
		expect(state.vaults.get(ACCOUNT)?.masterKey).toBeDefined();
		expect(state.vaults.get(ACCOUNT)?.product).toBeUndefined();
		expect(gate.vaultModeOf(ACCOUNT)).toBe('account');
		expect(custodyDb.vaults.size).toBe(0);

		custodyDb.failCommit = null;
		expect(await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') })).toEqual({ ok: true });
		expect(state.vaults.get(ACCOUNT)?.product).toBe('app');
	});

	it('adopts only keys it can authenticate and that cover what the vault holds', async () => {
		const upload = await prepared();
		const tampered = stored(upload);
		tampered.rootBundle = tampered.rootBundle.slice();
		tampered.rootBundle[tampered.rootBundle.length - 6] ^= 1;
		expect(await ops.handleCustodyAdopt({ accountId: ACCOUNT, migrationId: MIGRATION, source: { kind: 'candidate', stored: tampered } })).toMatchObject({ ok: false, code: 'invalid' });

		const { privateKey: extra } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'calloway3@thelemail.test' }], format: 'object', config: { v6Keys: true } });
		installLegacy(extra);
		const res = await ops.handleCustodyAdopt({ accountId: ACCOUNT, migrationId: MIGRATION, source: { kind: 'candidate', stored: stored(upload) } });
		expect(res).toMatchObject({ ok: false, code: 'invalid' });
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: null })).toEqual({ ok: false, code: 'missing' });
	});

	it('lets a second device adopt the first device candidate', async () => {
		const first = await prepared();
		const second = await prepared();
		expect(await candidateHash(first.record)).not.toEqual(await candidateHash(second.record));
		const res = await ops.handleCustodyAdopt({ accountId: ACCOUNT, migrationId: MIGRATION, source: { kind: 'candidate', stored: stored(first) } });
		expect(res).toMatchObject({ ok: true, kind: 'candidate' });
		if (res.ok) expect(res.digest).toEqual(await candidateHash(first.record));
	});

	it('refuses custody commands out of order or on the wrong vault', async () => {
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: null })).toEqual({ ok: false, code: 'missing' });
		await adopted();
		expect(await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') })).toEqual({ ok: false, code: 'missing' });
		await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: null });
		expect(await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-staged') })).toMatchObject({ ok: false, code: 'invalid' });
		expect(await ops.handleCustodyRetire({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('legacy-retired-local') })).toEqual({ ok: false, code: 'unsupported' });
		await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') });
		expect(await ops.handleCustodyPrepare({ ...prepareArgs, migrationId: MIGRATION })).toEqual({ ok: false, code: 'unsupported' });
		expect(await ops.handleCustodyRetire({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') })).toMatchObject({ ok: false, code: 'invalid' });
		state.handleLock({ accountId: ACCOUNT });
		expect(await ops.handleCustodyRetire({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('legacy-retired-local') })).toEqual({ ok: false, code: 'locked' });
	});

	it('forgets an adopted root when the vault locks', async () => {
		await adopted();
		ops.forgetPendingCustody(ACCOUNT);
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: null })).toEqual({ ok: false, code: 'missing' });
	});
});

describe('worker restart at each custody boundary', () => {
	it('before the local commit comes back as a legacy vault with nothing lost', async () => {
		await adopted();
		await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() });
		expect(custodyDb.staged.size).toBe(1);

		await load();
		expect(state.productAccounts.has(ACCOUNT)).toBe(false);
		expect(state.cachedRecords.get(ACCOUNT)?.wrappedMasterKey).toBe('d3JhcHBlZA==');
		expect((await state.handleStatus()).accounts[0]).toMatchObject({ accountId: ACCOUNT, unlocked: false });
		expect((await state.handleStatus()).accounts[0].mailOnly).toBeUndefined();
		expect(legacyDb.records.has(ACCOUNT)).toBe(true);
		installLegacy();
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() })).toEqual({ ok: false, code: 'missing' });
		await adopted();
		expect(await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() })).toEqual({ ok: true, durable: true });
	});

	it('after the local commit comes back mail-only and restores with the new half', async () => {
		await adopted();
		const serverHalf = half();
		await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf });
		await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') });

		await load();
		expect(state.productAccounts.has(ACCOUNT)).toBe(true);
		expect(state.cachedRecords.get(ACCOUNT)?.wrapPayloadVersion).toBe(4);
		expect(legacyDb.records.has(ACCOUNT)).toBe(true);
		expect((await state.handleStatus()).accounts).toEqual([{ accountId: ACCOUNT, email: EMAIL, unlocked: false, hasPersistent: true, authScheme: 'opaque_v1', mailOnly: true }]);
		expect(gate.commandAllowed('opaqueCompleteLoginUnlock', { accountId: ACCOUNT })).toBe(false);
		expect(await persist.handleTryRestoreFromPersistent({ accountId: ACCOUNT, serverHalf })).toMatchObject({ ok: true });
		expect(state.vaults.get(ACCOUNT)?.product).toBe('app');
		expect(await ops.handleCustodyRetire({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('legacy-retired-local') })).toEqual({ ok: true });
		expect(legacyDb.records.has(ACCOUNT)).toBe(false);
	});

	it('after retirement removes a legacy record an old tab wrote back', async () => {
		await adopted();
		const serverHalf = half();
		await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf });
		await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') });
		await ops.handleCustodyRetire({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('legacy-retired-local') });
		legacyDb.records.set(ACCOUNT, legacyRecord());

		await load();
		expect(legacyDb.records.has(ACCOUNT)).toBe(false);
		expect(state.cachedRecords.get(ACCOUNT)?.wrapPayloadVersion).toBe(4);
		expect(await persist.handleTryRestoreFromPersistent({ accountId: ACCOUNT, serverHalf })).toMatchObject({ ok: true });
	});

	it('a memory-only mail vault that lost its worker stays mail-only and locked', async () => {
		await adopted();
		await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: null });
		await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') });
		await ops.handleCustodyRetire({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('legacy-retired-local') });

		await load();
		expect(state.productAccounts.has(ACCOUNT)).toBe(true);
		expect(state.cachedRecords.has(ACCOUNT)).toBe(false);
		expect(gate.vaultModeOf(ACCOUNT)).toBe('mail');
		expect(gate.commandAllowed('opaqueFinishAuth', { accountId: ACCOUNT })).toBe(false);
		expect(gate.commandAllowed('adoptHandoff', { accountId: ACCOUNT })).toBe(true);
	});

	it('signing out forgets the custody of that account only', async () => {
		await adopted();
		await ops.handleCustodyStage({ accountId: ACCOUNT, migrationId: MIGRATION, serverHalf: half() });
		await ops.handleCustodyCommit({ accountId: ACCOUNT, migrationId: MIGRATION, journal: journal('mail-committed') });
		await state.handleClear({ accountId: ACCOUNT });
		expect(custodyDb.journals.size + custodyDb.vaults.size).toBe(0);
		expect(state.productAccounts.has(ACCOUNT)).toBe(false);
		expect(gate.vaultModeOf(ACCOUNT)).toBeNull();
	});
});
