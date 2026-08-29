/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { CryptoProxy } from '@protontech/crypto';
import { Api as CryptoApi } from '@protontech/crypto/proxy/endpoint/api.ts';
import {
	AUTH_VERSION,
	computeKeyPassword,
	generateKeySalt,
	getRandomSrpVerifier,
	getSrp
} from '@protontech/crypto/srp';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';

import {
	clearAllVaults,
	deleteVault,
	getAllVaults,
	getVault,
	putVault,
	type VaultRecord
} from './idb';
import {
	KEY_STRETCHING,
	OPAQUE_PARAMS_VERSION,
	SERVER_IDENTITY,
	base64ToBase64Url,
	base64ToBytes as opaqueBase64ToBytes,
	base64UrlToBase64,
	base64UrlToBytes,
	bytesToBase64 as opaqueBytesToBase64,
	bytesToBase64Url,
	clientIdentity,
	deriveMasterKeyId,
	derivePgpPassphrase,
	generateAMK,
	unwrapMasterKey,
	wrapMasterKey
} from './opaque-params';
import type {
	Broadcast,
	ClearArgs,
	CommitPasswordChangeArgs,
	CommitPasswordChangeResponse,
	CompleteLoginUnlockArgs,
	CompleteLoginUnlockResponse,
	CompleteRecoveryUnlockArgs,
	CompleteRecoveryUnlockResponse,
	DecryptArgs,
	LoadAliasKeysArgs,
	LoadAliasKeysResponse,
	UnloadAliasKeysArgs,
	CreateAliasKeyArgs,
	CreateAliasKeyResponse,
	DecryptResponse,
	DisablePersistentArgs,
	EncryptArgs,
	EncryptResponse,
	EncryptToKeysArgs,
	EncryptToKeysResponse,
	EnrollPersistentArgs,
	GetPublicKeyArgs,
	GetPublicKeyResponse,
	SignatureVerdict,
	ReformatKeyWithUidsArgs,
	ReformatKeyWithUidsResponse,
	CommitReformattedKeyArgs,
	CommitReformattedKeyResponse,
	InvalidatePersistedVaultArgs,
	LockArgs,
	MigrationFinishStageArgs,
	MigrationFinishStageResponse,
	MigrationStartRegistrationArgs,
	MigrationStartRegistrationResponse,
	OpaqueAbandonOperationArgs,
	OpaqueCompleteLoginUnlockArgs,
	OpaqueCompleteLoginUnlockResponse,
	OpaqueCompleteRecoveryUnlockArgs,
	OpaqueCompleteRecoveryUnlockResponse,
	OpaqueFinalizeRegisterArgs,
	OpaqueFinalizeRegisterResponse,
	OpaqueFinishAmkRotationArgs,
	OpaquePrepareAmkRotationArgs,
	OpaquePrepareAmkRotationResponse,
	OpaqueFinishAmkRotationResponse,
	OpaqueFinishAuthArgs,
	OpaqueFinishAuthResponse,
	OpaqueFinishCredentialResetArgs,
	OpaqueFinishCredentialResetResponse,
	OpaqueFinishRegistrationArgs,
	OpaqueFinishRegistrationResponse,
	OpaquePasswordChangeCommitArgs,
	OpaquePasswordChangeCommitResponse,
	OpaquePasswordChangeFinishArgs,
	OpaquePasswordChangeFinishResponse,
	OpaquePasswordChangeStartArgs,
	OpaquePasswordChangeStartResponse,
	OpaquePrepareCredentialResetArgs,
	OpaquePrepareCredentialResetResponse,
	OpaqueRecoverySetupFinishArgs,
	OpaqueRecoverySetupFinishResponse,
	OpaqueRecoverySetupStartArgs,
	OpaqueRecoverySetupStartResponse,
	OpaqueStartAuthArgs,
	OpaqueStartAuthResponse,
	OpaqueStartRegistrationArgs,
	OpaqueStartRegistrationResponse,
	PrepareCredentialResetArgs,
	PrepareCredentialResetResponse,
	PrepareDeletionProofArgs,
	PrepareDeletionProofResponse,
	PrepareLoginArgs,
	PrepareLoginResponse,
	PreparePasswordChangeCredentialsArgs,
	PreparePasswordChangeCredentialsResponse,
	PreparePasswordChangeProofArgs,
	PreparePasswordChangeProofResponse,
	PrepareRecoveryLoginArgs,
	PrepareRecoveryLoginResponse,
	PrepareRecoverySetupArgs,
	PrepareRecoverySetupResponse,
	RestoreResponse,
	StatusResponse,
	TryRestoreFromPersistentArgs,
	VerifyLoginProofArgs,
	VerifyLoginProofResponse,
	VerifyPasswordChangeProofArgs,
	VerifyPasswordChangeProofResponse,
	VerifyRecoveryProofArgs,
	VerifyRecoveryProofResponse
} from './protocol';

declare const self: SharedWorkerGlobalScope;

interface VaultState {
	accountId: string;
	email: string;
	authScheme: 'srp_v1' | 'opaque_v1';
	srpSalt?: string;
	keySalt?: string;
	wrappedMasterKey?: string;
	masterKeyId?: string;
	opaqueParamsVersion?: number;
	masterKey?: Uint8Array;
	armoredEncryptedPrivateKey: string;
	privateKey: openpgp.PrivateKey;
	keyPassword: string;
	wrapKey?: CryptoKey;
	aliasKeys: Map<string, AliasKeyEntry>;
	aliasCurrent: Map<string, string>;
}

interface AliasKeyEntry {
	aliasId: string;
	addressId: string;
	email: string;
	keyVersion: number;
	fingerprintHex: string;
	privateKey: openpgp.PrivateKey;
}

interface PendingLogin {
	email: string;
	password: string;
	expectedServerProof: string;
	proofVerified: boolean;
	verifiedAt: number | null;
}

const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

interface PendingRecoveryLogin {
	email: string;
	phrase: string;
	expectedServerProof: string;
	proofVerified: boolean;
	verifiedAt: number | null;
}

interface PendingReset {
	email: string;
	privateKey: openpgp.PrivateKey;
	expiresAt: number;
}

interface PendingPasswordChange {
	accountId: string;
	expectedServerProof: string;
	proofVerified: boolean;
	verifiedAt: number | null;
	newCredentials: {
		srpSalt: string;
		keySalt: string;
		armoredEncryptedPrivateKey: string;
	} | null;
}

const vaults = new Map<string, VaultState>();
const cachedRecords = new Map<string, VaultRecord>();
let pendingLogin: PendingLogin | null = null;
let pendingRecoveryLogin: PendingRecoveryLogin | null = null;
let pendingReset: PendingReset | null = null;
let pendingPasswordChange: PendingPasswordChange | null = null;
let cryptoReady: Promise<void> | null = null;
const ports = new Set<MessagePort>();
const opaqueOps = new Map<string, OpaqueOperation>();
const OPAQUE_OP_TTL_MS = 10 * 60 * 1000;

const restorePromise = restoreFromIdb();

async function restoreFromIdb() {
	try {
		const all = await getAllVaults();
		for (const rec of all) {
			cachedRecords.set(rec.accountId, rec);
		}
	} catch (err) {
		console.warn('keystore: idb restore failed', err);
	}
}

async function ensureCryptoReady(): Promise<void> {
	if (cryptoReady) return cryptoReady;
	cryptoReady = (async () => {
		CryptoApi.init({});
		const api = new CryptoApi();
		try {
			CryptoProxy.setEndpoint(api);
		} catch (err) {
			if (!(err instanceof Error) || !/already initialised/i.test(err.message)) {
				throw err;
			}
		}
	})();
	return cryptoReady;
}

function broadcast(msg: Broadcast) {
	for (const p of ports) {
		p.postMessage(msg);
	}
}

function wipe(s: string): void {
	void s;
}

function hasPersistentFor(rec: VaultRecord | undefined): boolean {
	return !!(rec && rec.localHalfKey && rec.wrappedPrivateKey && rec.wrapIv);
}

async function handleStatus(): Promise<StatusResponse> {
	await restorePromise;
	const seen = new Set<string>();
	const accounts: StatusResponse['accounts'] = [];
	for (const v of vaults.values()) {
		const rec = cachedRecords.get(v.accountId);
		accounts.push({
			accountId: v.accountId,
			email: v.email,
			unlocked: true,
			hasPersistent: hasPersistentFor(rec),
			authScheme: v.authScheme
		});
		seen.add(v.accountId);
	}
	for (const rec of cachedRecords.values()) {
		if (seen.has(rec.accountId)) continue;
		accounts.push({
			accountId: rec.accountId,
			email: rec.email,
			unlocked: false,
			hasPersistent: hasPersistentFor(rec),
			authScheme: rec.authScheme
		});
	}
	return { accounts };
}

async function handlePrepareLogin(args: PrepareLoginArgs): Promise<PrepareLoginResponse> {
	await ensureCryptoReady();
	const proofs = await getSrp(
		{
			Version: AUTH_VERSION,
			Modulus: args.modulus,
			ServerEphemeral: args.serverPublicEphemeral,
			Salt: args.salt
		},
		{ username: args.email, password: args.password }
	);
	pendingLogin = {
		email: args.email,
		password: args.password,
		expectedServerProof: proofs.expectedServerProof,
		proofVerified: false,
		verifiedAt: null
	};
	return {
		clientPublicEphemeral: proofs.clientEphemeral,
		clientProof: proofs.clientProof
	};
}

function handleVerifyLoginProof(args: VerifyLoginProofArgs): VerifyLoginProofResponse {
	const pending = pendingLogin;
	if (!pending) {
		return { ok: false, code: 'no_pending_login' };
	}
	if (!constantTimeEqual(args.serverProof, pending.expectedServerProof)) {
		wipe(pending.password);
		pendingLogin = null;
		return { ok: false, code: 'invalid_credentials' };
	}
	pending.proofVerified = true;
	pending.verifiedAt = Date.now();
	return { ok: true };
}

function handleAbandonLogin(): void {
	if (pendingLogin) {
		wipe(pendingLogin.password);
		pendingLogin = null;
	}
}

async function handleCompleteLoginUnlock(
	args: CompleteLoginUnlockArgs
): Promise<CompleteLoginUnlockResponse> {
	const pending = pendingLogin;
	if (!pending) {
		return { ok: false, code: 'no_pending_login' };
	}
	if (!pending.proofVerified || pending.verifiedAt === null) {
		return { ok: false, code: 'proof_not_verified' };
	}
	if (Date.now() - pending.verifiedAt > PENDING_LOGIN_TTL_MS) {
		wipe(pending.password);
		pendingLogin = null;
		return { ok: false, code: 'no_pending_login' };
	}
	pendingLogin = null;

	try {
		const passphrase = await computeKeyPassword(pending.password, args.keySalt);
		const armored = args.encryptedPrivateKey;
		const privateKey = await openpgp.readPrivateKey({ armoredKey: armored });
		const unlocked = await openpgp.decryptKey({ privateKey, passphrase });

		const record: VaultRecord = {
			accountId: args.accountId,
			email: pending.email,
			authScheme: 'srp_v1',
			srpSalt: args.srpSalt,
			keySalt: args.keySalt,
			armoredEncryptedPrivateKey: armored,
			updatedAt: Date.now()
		};
		await putVault(record);
		cachedRecords.set(args.accountId, record);

		const v: VaultState = {
			accountId: args.accountId,
			email: pending.email,
			authScheme: 'srp_v1',
			srpSalt: args.srpSalt,
			keySalt: args.keySalt,
			armoredEncryptedPrivateKey: armored,
			privateKey: unlocked,
			keyPassword: passphrase,
			aliasKeys: new Map(),
			aliasCurrent: new Map()
		};
		vaults.set(args.accountId, v);

		wipe(pending.password);
		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true, accountId: v.accountId, email: v.email };
	} catch (err) {
		wipe(pending.password);
		console.warn('keystore: completeLoginUnlock failed', err);
		return { ok: false, code: 'invalid_credentials' };
	}
}

async function handlePrepareRecoverySetup(
	args: PrepareRecoverySetupArgs
): Promise<PrepareRecoverySetupResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	await ensureCryptoReady();

	const phrase = generateMnemonic(wordlist, 128);
	const keySalt = generateKeySalt();
	const passphrase = await computeKeyPassword(phrase, keySalt);
	const encrypted = await openpgp.encryptKey({ privateKey: v.privateKey, passphrase });

	const { salt: srpSalt, verifier: srpVerifier } = await getRandomSrpVerifier(
		{ Modulus: args.modulus },
		{ username: v.email, password: phrase }
	);

	return {
		ok: true,
		phrase,
		srpSalt,
		srpVerifier,
		keySalt,
		encryptedPrivateKey: encrypted.armor()
	};
}

async function handlePrepareRecoveryLogin(
	args: PrepareRecoveryLoginArgs
): Promise<PrepareRecoveryLoginResponse> {
	await ensureCryptoReady();
	const proofs = await getSrp(
		{
			Version: AUTH_VERSION,
			Modulus: args.modulus,
			ServerEphemeral: args.serverPublicEphemeral,
			Salt: args.salt
		},
		{ username: args.email, password: args.phrase }
	);
	pendingRecoveryLogin = {
		email: args.email,
		phrase: args.phrase,
		expectedServerProof: proofs.expectedServerProof,
		proofVerified: false,
		verifiedAt: null
	};
	return {
		clientPublicEphemeral: proofs.clientEphemeral,
		clientProof: proofs.clientProof
	};
}

function handleVerifyRecoveryProof(args: VerifyRecoveryProofArgs): VerifyRecoveryProofResponse {
	const pending = pendingRecoveryLogin;
	if (!pending) {
		return { ok: false, code: 'no_pending_recovery' };
	}
	if (!constantTimeEqual(args.serverProof, pending.expectedServerProof)) {
		wipe(pending.phrase);
		pendingRecoveryLogin = null;
		return { ok: false, code: 'invalid_credentials' };
	}
	pending.proofVerified = true;
	pending.verifiedAt = Date.now();
	return { ok: true };
}

async function handleCompleteRecoveryUnlock(
	args: CompleteRecoveryUnlockArgs
): Promise<CompleteRecoveryUnlockResponse> {
	const pending = pendingRecoveryLogin;
	if (!pending) {
		return { ok: false, code: 'no_pending_recovery' };
	}
	if (!pending.proofVerified || pending.verifiedAt === null) {
		return { ok: false, code: 'proof_not_verified' };
	}
	if (Date.now() - pending.verifiedAt > PENDING_LOGIN_TTL_MS) {
		wipe(pending.phrase);
		pendingRecoveryLogin = null;
		return { ok: false, code: 'no_pending_recovery' };
	}
	pendingRecoveryLogin = null;

	try {
		const passphrase = await computeKeyPassword(pending.phrase, args.keySalt);
		const privateKey = await openpgp.readPrivateKey({ armoredKey: args.encryptedPrivateKey });
		const unlocked = await openpgp.decryptKey({ privateKey, passphrase });

		pendingReset = {
			email: pending.email,
			privateKey: unlocked,
			expiresAt: Date.now() + args.resetTokenExpiresInSeconds * 1000 - 10_000
		};
		wipe(pending.phrase);
		return { ok: true };
	} catch (err) {
		wipe(pending.phrase);
		console.warn('keystore: completeRecoveryUnlock failed', err);
		return { ok: false, code: 'invalid_credentials' };
	}
}

async function handlePrepareCredentialReset(
	args: PrepareCredentialResetArgs
): Promise<PrepareCredentialResetResponse> {
	const p = pendingReset;
	if (!p) {
		return { ok: false, code: 'no_pending_reset' };
	}
	if (Date.now() > p.expiresAt) {
		pendingReset = null;
		return { ok: false, code: 'reset_expired' };
	}
	await ensureCryptoReady();

	const keySalt = generateKeySalt();
	const passphrase = await computeKeyPassword(args.newPassword, keySalt);
	const encrypted = await openpgp.encryptKey({ privateKey: p.privateKey, passphrase });

	const { salt: srpSalt, verifier: srpVerifier } = await getRandomSrpVerifier(
		{ Modulus: args.modulus },
		{ username: p.email, password: args.newPassword }
	);

	return {
		ok: true,
		srpSalt,
		srpVerifier,
		keySalt,
		encryptedPrivateKey: encrypted.armor()
	};
}

function handleDiscardRecovery(): void {
	pendingRecoveryLogin = null;
	pendingReset = null;
}

async function handlePrepareDeletionProof(
	args: PrepareDeletionProofArgs
): Promise<PrepareDeletionProofResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	await ensureCryptoReady();
	const proofs = await getSrp(
		{
			Version: AUTH_VERSION,
			Modulus: args.modulus,
			ServerEphemeral: args.serverPublicEphemeral,
			Salt: args.salt
		},
		{ username: v.email, password: args.password }
	);
	return {
		ok: true,
		clientPublicEphemeral: proofs.clientEphemeral,
		clientProof: proofs.clientProof,
		expectedServerProof: proofs.expectedServerProof
	};
}

async function handlePreparePasswordChangeProof(
	args: PreparePasswordChangeProofArgs
): Promise<PreparePasswordChangeProofResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	await ensureCryptoReady();
	const proofs = await getSrp(
		{
			Version: AUTH_VERSION,
			Modulus: args.modulus,
			ServerEphemeral: args.serverPublicEphemeral,
			Salt: args.salt
		},
		{ username: v.email, password: args.currentPassword }
	);
	pendingPasswordChange = {
		accountId: args.accountId,
		expectedServerProof: proofs.expectedServerProof,
		proofVerified: false,
		verifiedAt: null,
		newCredentials: null
	};
	return {
		ok: true,
		clientPublicEphemeral: proofs.clientEphemeral,
		clientProof: proofs.clientProof
	};
}

function handleVerifyPasswordChangeProof(
	args: VerifyPasswordChangeProofArgs
): VerifyPasswordChangeProofResponse {
	const pending = pendingPasswordChange;
	if (!pending) {
		return { ok: false, code: 'no_pending_change' };
	}
	if (!constantTimeEqual(args.serverProof, pending.expectedServerProof)) {
		pendingPasswordChange = null;
		return { ok: false, code: 'invalid_credentials' };
	}
	pending.proofVerified = true;
	pending.verifiedAt = Date.now();
	return { ok: true };
}

async function handlePreparePasswordChangeCredentials(
	args: PreparePasswordChangeCredentialsArgs
): Promise<PreparePasswordChangeCredentialsResponse> {
	const pending = pendingPasswordChange;
	if (!pending || pending.accountId !== args.accountId) {
		return { ok: false, code: 'no_pending_change' };
	}
	if (!pending.proofVerified || pending.verifiedAt === null) {
		return { ok: false, code: 'proof_not_verified' };
	}
	if (Date.now() - pending.verifiedAt > PENDING_LOGIN_TTL_MS) {
		pendingPasswordChange = null;
		return { ok: false, code: 'change_expired' };
	}
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	await ensureCryptoReady();

	const keySalt = generateKeySalt();
	const passphrase = await computeKeyPassword(args.newPassword, keySalt);
	const encrypted = await openpgp.encryptKey({ privateKey: v.privateKey, passphrase });
	const armoredEncrypted = encrypted.armor();

	const { salt: srpSalt, verifier: srpVerifier } = await getRandomSrpVerifier(
		{ Modulus: args.modulus },
		{ username: v.email, password: args.newPassword }
	);

	pending.newCredentials = {
		srpSalt,
		keySalt,
		armoredEncryptedPrivateKey: armoredEncrypted
	};

	return {
		ok: true,
		srpSalt,
		srpVerifier,
		keySalt,
		encryptedPrivateKey: armoredEncrypted
	};
}

async function handleCommitPasswordChange(
	args: CommitPasswordChangeArgs
): Promise<CommitPasswordChangeResponse> {
	const pending = pendingPasswordChange;
	if (!pending || pending.accountId !== args.accountId || !pending.newCredentials) {
		return { ok: false, code: 'no_pending_change' };
	}
	const v = vaults.get(args.accountId);
	if (!v) {
		pendingPasswordChange = null;
		return { ok: false, code: 'locked' };
	}
	const creds = pending.newCredentials;
	pendingPasswordChange = null;

	v.srpSalt = creds.srpSalt;
	v.keySalt = creds.keySalt;
	v.armoredEncryptedPrivateKey = creds.armoredEncryptedPrivateKey;

	const prev = cachedRecords.get(args.accountId);
	const record: VaultRecord = {
		accountId: v.accountId,
		email: v.email,
		authScheme: 'srp_v1',
		srpSalt: creds.srpSalt,
		keySalt: creds.keySalt,
		armoredEncryptedPrivateKey: creds.armoredEncryptedPrivateKey,
		updatedAt: Date.now(),
		wrappedPrivateKey: prev?.wrappedPrivateKey,
		wrapIv: prev?.wrapIv,
		localHalfKey: prev?.localHalfKey
	};

	let persisted = true;
	try {
		await putVault(record);
		cachedRecords.set(args.accountId, record);
	} catch (err) {
		console.warn('keystore: commitPasswordChange persist failed, dropping stale record', err);
		persisted = false;
		cachedRecords.delete(args.accountId);
		try {
			await deleteVault(args.accountId);
		} catch (delErr) {
			console.warn('keystore: commitPasswordChange cleanup failed', delErr);
		}
	}

	broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
	return { ok: true, persisted };
}

async function handleInvalidatePersistedVault(args: InvalidatePersistedVaultArgs): Promise<void> {
	cachedRecords.delete(args.accountId);
	try {
		await deleteVault(args.accountId);
	} catch (err) {
		console.warn('keystore: invalidatePersistedVault failed', err);
	}
	broadcast({ type: 'persistentDisabled', accountId: args.accountId });
}

function handleAbandonPasswordChange(): void {
	pendingPasswordChange = null;
}

async function handleClear(args: ClearArgs): Promise<void> {
	vaults.delete(args.accountId);
	cachedRecords.delete(args.accountId);
	await deleteVault(args.accountId);
	broadcast({ type: 'cleared', accountId: args.accountId });
}

async function handleClearAll(): Promise<void> {
	vaults.clear();
	cachedRecords.clear();
	pendingLogin = null;
	pendingRecoveryLogin = null;
	pendingReset = null;
	pendingPasswordChange = null;
	for (const op of opaqueOps.values()) {
		wipeOpaqueOperation(op);
	}
	opaqueOps.clear();
	await clearAllVaults();
	broadcast({ type: 'clearedAll' });
}

function handleLock(args: LockArgs): void {
	if (vaults.delete(args.accountId)) {
		broadcast({ type: 'locked', accountId: args.accountId });
	}
}

const HKDF_INFO_V1 = new TextEncoder().encode('thelemail-vault-wrap-v1');
const HKDF_INFO_V2 = new TextEncoder().encode('thelemail-vault-wrap-v2');

function base64ToBytes(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

async function deriveWrapKey(
	localHalfKey: CryptoKey,
	serverHalf: Uint8Array,
	wrapVersion: 1 | 2 = 1
): Promise<CryptoKey> {
	const info = wrapVersion === 2 ? HKDF_INFO_V2 : HKDF_INFO_V1;
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: serverHalf as BufferSource, info: info as BufferSource },
		localHalfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

async function handleEnrollPersistent(args: EnrollPersistentArgs): Promise<void> {
	const v = vaults.get(args.accountId);
	if (!v) {
		throw new Error('keystore: cannot enroll persistent — vault is locked');
	}
	const ikm = crypto.getRandomValues(new Uint8Array(32));
	const localHalfKey = await crypto.subtle.importKey(
		'raw',
		ikm as BufferSource,
		'HKDF',
		false,
		['deriveKey']
	);
	ikm.fill(0);

	const wrapVersion: 1 | 2 = v.authScheme === 'opaque_v1' && v.masterKey ? 2 : 1;
	const serverHalfBytes = base64ToBytes(args.serverHalf);
	const wrapKey = await deriveWrapKey(localHalfKey, serverHalfBytes, wrapVersion);
	serverHalfBytes.fill(0);

	const wrappedPayload =
		wrapVersion === 2
			? JSON.stringify({ m: opaqueBytesToBase64(v.masterKey as Uint8Array) })
			: JSON.stringify({ k: v.privateKey.armor(), p: v.keyPassword });
	const wrapIv = crypto.getRandomValues(new Uint8Array(12));
	const wrappedPrivateKey = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: wrapIv as BufferSource },
			wrapKey,
			new TextEncoder().encode(wrappedPayload) as BufferSource
		)
	);

	const updated: VaultRecord = {
		accountId: v.accountId,
		email: v.email,
		authScheme: v.authScheme,
		srpSalt: v.srpSalt,
		keySalt: v.keySalt,
		wrappedMasterKey: v.wrappedMasterKey,
		masterKeyId: v.masterKeyId,
		opaqueParamsVersion: v.opaqueParamsVersion,
		armoredEncryptedPrivateKey: v.armoredEncryptedPrivateKey,
		updatedAt: Date.now(),
		wrappedPrivateKey,
		wrapIv,
		wrapPayloadVersion: wrapVersion,
		localHalfKey
	};
	await putVault(updated);
	cachedRecords.set(v.accountId, updated);
	v.wrapKey = wrapKey;
}

async function handleTryRestoreFromPersistent(
	args: TryRestoreFromPersistentArgs
): Promise<RestoreResponse> {
	await restorePromise;
	const rec = cachedRecords.get(args.accountId) ?? (await getVault(args.accountId)) ?? undefined;
	if (rec) cachedRecords.set(rec.accountId, rec);
	if (!rec || !rec.localHalfKey || !rec.wrappedPrivateKey || !rec.wrapIv) {
		return { ok: false, reason: 'no_persistent' };
	}
	await ensureCryptoReady();
	const wrapVersion = rec.wrapPayloadVersion ?? 1;
	try {
		const serverHalfBytes = base64ToBytes(args.serverHalf);
		const wrapKey = await deriveWrapKey(rec.localHalfKey, serverHalfBytes, wrapVersion);
		serverHalfBytes.fill(0);

		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: rec.wrapIv as BufferSource },
			wrapKey,
			rec.wrappedPrivateKey as BufferSource
		);
		const decoded = new TextDecoder().decode(plaintext);

		if (wrapVersion === 2) {
			const parsed = JSON.parse(decoded);
			const masterKey = opaqueBase64ToBytes(parsed.m as string);
			const keyPassword = await derivePgpPassphrase(masterKey);
			const privateKey = await openpgp.readPrivateKey({
				armoredKey: rec.armoredEncryptedPrivateKey
			});
			const unlocked = await openpgp.decryptKey({ privateKey, passphrase: keyPassword });

			const v: VaultState = {
				accountId: rec.accountId,
				email: rec.email,
				authScheme: 'opaque_v1',
				wrappedMasterKey: rec.wrappedMasterKey,
				masterKeyId: rec.masterKeyId,
				opaqueParamsVersion: rec.opaqueParamsVersion,
				masterKey,
				armoredEncryptedPrivateKey: rec.armoredEncryptedPrivateKey,
				privateKey: unlocked,
				keyPassword,
				wrapKey,
				aliasKeys: new Map(),
				aliasCurrent: new Map()
			};
			vaults.set(rec.accountId, v);
			broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
			return { ok: true, accountId: v.accountId, email: v.email };
		}

		let armored = decoded;
		let keyPassword = '';
		try {
			const parsed = JSON.parse(decoded);
			if (parsed && typeof parsed.k === 'string') {
				armored = parsed.k;
				keyPassword = typeof parsed.p === 'string' ? parsed.p : '';
			}
		} catch {
			armored = decoded;
		}
		const privateKey = (await openpgp.readPrivateKey({
			armoredKey: armored
		})) as openpgp.PrivateKey;

		const v: VaultState = {
			accountId: rec.accountId,
			email: rec.email,
			authScheme: 'srp_v1',
			srpSalt: rec.srpSalt,
			keySalt: rec.keySalt,
			armoredEncryptedPrivateKey: rec.armoredEncryptedPrivateKey,
			privateKey,
			keyPassword,
			wrapKey,
			aliasKeys: new Map(),
			aliasCurrent: new Map()
		};
		vaults.set(rec.accountId, v);
		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true, accountId: v.accountId, email: v.email };
	} catch (err) {
		console.warn('keystore: tryRestoreFromPersistent failed', err);
		return { ok: false, reason: 'unwrap_failed' };
	}
}

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function fingerprintHexOf(key: openpgp.Key): string {
	const fp = key.getFingerprint();
	if (typeof fp === 'string') return fp.toLowerCase();
	return [...new Uint8Array(fp as ArrayLike<number>)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function aliasSigningKey(v: VaultState, aliasId: string | undefined): openpgp.PrivateKey | null {
	if (!aliasId) return v.privateKey;
	const fp = v.aliasCurrent.get(aliasId);
	if (!fp) return null;
	return v.aliasKeys.get(fp)?.privateKey ?? null;
}

function recomputeAliasCurrent(v: VaultState) {
	v.aliasCurrent.clear();
	const best = new Map<string, AliasKeyEntry>();
	for (const entry of v.aliasKeys.values()) {
		const cur = best.get(entry.aliasId);
		if (!cur || entry.keyVersion > cur.keyVersion) best.set(entry.aliasId, entry);
	}
	for (const [aliasId, entry] of best) v.aliasCurrent.set(aliasId, entry.fingerprintHex);
}

async function handleLoadAliasKeys(args: LoadAliasKeysArgs): Promise<LoadAliasKeysResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	const loaded: string[] = [];
	const failed: { aliasId: string; keyVersion: number }[] = [];
	for (const g of args.grants) {
		const want = g.aliasKeyFingerprintHex.toLowerCase();
		if (v.aliasKeys.has(want)) {
			loaded.push(want);
			continue;
		}
		try {
			const message = await openpgp.readMessage({ armoredMessage: g.wrappedPrivateKeyArmored });
			const { data } = await openpgp.decrypt({
				message,
				decryptionKeys: v.privateKey,
				expectSigned: false
			});
			if (typeof data !== 'string') {
				failed.push({ aliasId: g.aliasId, keyVersion: g.keyVersion });
				continue;
			}
			const privateKey = await openpgp.readPrivateKey({ armoredKey: data });
			const got = fingerprintHexOf(privateKey);
			if (got !== want) {
				failed.push({ aliasId: g.aliasId, keyVersion: g.keyVersion });
				continue;
			}
			v.aliasKeys.set(got, {
				aliasId: g.aliasId,
				addressId: g.addressId,
				email: g.email,
				keyVersion: g.keyVersion,
				fingerprintHex: got,
				privateKey
			});
			loaded.push(got);
		} catch (err) {
			console.warn('keystore: alias key unwrap failed', err);
			failed.push({ aliasId: g.aliasId, keyVersion: g.keyVersion });
		}
	}
	recomputeAliasCurrent(v);
	broadcast({
		type: 'aliasKeysChanged',
		accountId: args.accountId,
		fingerprints: [...v.aliasKeys.keys()]
	});
	return { ok: true, loaded, failed };
}

function handleUnloadAliasKeys(args: UnloadAliasKeysArgs): void {
	const v = vaults.get(args.accountId);
	if (!v) return;
	v.aliasKeys.clear();
	v.aliasCurrent.clear();
	broadcast({ type: 'aliasKeysChanged', accountId: args.accountId, fingerprints: [] });
}

async function handleCreateAliasKey(args: CreateAliasKeyArgs): Promise<CreateAliasKeyResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!args.recipients.length) {
		return { ok: false, code: 'no_recipients' };
	}
	let recipientKeys: { accountId: string; key: openpgp.Key }[];
	try {
		recipientKeys = await Promise.all(
			args.recipients.map(async (r) => ({
				accountId: r.accountId,
				key: await openpgp.readKey({ armoredKey: r.publicKeyArmored })
			}))
		);
	} catch (err) {
		console.warn('keystore: alias key invalid recipient', err);
		return { ok: false, code: 'invalid_recipient_key' };
	}
	try {
		const generated = await openpgp.generateKey({
			type: 'curve25519',
			userIDs: [{ name: args.displayName, email: args.email }],
			format: 'object'
		});
		const armoredPrivate = generated.privateKey.armor();
		const grants = [];
		for (const r of recipientKeys) {
			const message = await openpgp.createMessage({ text: armoredPrivate });
			const wrapped = await openpgp.encrypt({
				message,
				encryptionKeys: r.key,
				signingKeys: v.privateKey,
				format: 'armored'
			});
			grants.push({
				accountId: r.accountId,
				wrappedPrivateKeyArmored: wrapped as string,
				memberKeyFingerprintHex: fingerprintHexOf(r.key)
			});
		}
		return {
			ok: true,
			publicKeyArmored: generated.publicKey.armor(),
			keyFingerprintHex: fingerprintHexOf(generated.privateKey),
			grants
		};
	} catch (err) {
		console.warn('keystore: alias key generation failed', err);
		return { ok: false, code: 'unknown' };
	}
}

async function handleGetPublicKey(args: GetPublicKeyArgs): Promise<GetPublicKeyResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	const signing = aliasSigningKey(v, args.aliasId);
	if (!signing) {
		return { ok: false, code: 'locked' };
	}
	const pub = signing.toPublic();
	const fp = pub.getFingerprint();
	const fingerprint = typeof fp === 'string' ? hexToBytes(fp) : new Uint8Array(fp as ArrayLike<number>);
	return {
		ok: true,
		publicKeyArmored: pub.armor(),
		fingerprint
	};
}

async function handleReformatKeyWithUids(
	args: ReformatKeyWithUidsArgs
): Promise<ReformatKeyWithUidsResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!v.keyPassword) {
		return { ok: false, code: 'no_key_password' };
	}
	const emails = Array.from(
		new Set(args.emails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0))
	).sort();
	if (emails.length === 0) {
		return { ok: false, code: 'no_emails' };
	}
	try {
		const desiredUids = emails.map((e) => `<${e}>`);
		const currentUids = Array.from(
			new Set(
				v.privateKey.users
					.map((u) => u.userID?.userID?.trim().toLowerCase())
					.filter((s): s is string => !!s && s.length > 0)
			)
		).sort();
		if (
			currentUids.length === desiredUids.length &&
			currentUids.every((s, i) => s === desiredUids[i])
		) {
			return { ok: true, unchanged: true };
		}

		const originalFingerprint = v.privateKey.getFingerprint();
		const { privateKey: reformatted } = await openpgp.reformatKey({
			privateKey: v.privateKey,
			userIDs: emails.map((email) => ({ email })),
			format: 'object'
		});
		if (reformatted.getFingerprint() !== originalFingerprint) {
			return { ok: false, code: 'fingerprint_changed' };
		}
		const encrypted = await openpgp.encryptKey({
			privateKey: reformatted,
			passphrase: v.keyPassword
		});
		const encryptedPrivateKey = encrypted.armor();
		const publicKeyArmored = reformatted.toPublic().armor();
		return { ok: true, unchanged: false, publicKeyArmored, encryptedPrivateKey };
	} catch (err) {
		console.warn('keystore: reformatKeyWithUids failed', err);
		return { ok: false, code: 'unknown' };
	}
}

async function handleCommitReformattedKey(
	args: CommitReformattedKeyArgs
): Promise<CommitReformattedKeyResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!v.keyPassword) {
		return { ok: false, code: 'no_key_password' };
	}
	try {
		const encrypted = (await openpgp.readPrivateKey({
			armoredKey: args.encryptedPrivateKey
		})) as openpgp.PrivateKey;
		const unlocked = await openpgp.decryptKey({
			privateKey: encrypted,
			passphrase: v.keyPassword
		});
		if (unlocked.getFingerprint() !== v.privateKey.getFingerprint()) {
			return { ok: false, code: 'invalid' };
		}

		v.privateKey = unlocked;
		v.armoredEncryptedPrivateKey = args.encryptedPrivateKey;

		const prev = cachedRecords.get(args.accountId);
		if (prev) {
			let wrappedPrivateKey = prev.wrappedPrivateKey;
			let wrapIv = prev.wrapIv;
			if (v.wrapKey && prev.wrappedPrivateKey && prev.wrapPayloadVersion !== 2) {
				const payload = JSON.stringify({ k: unlocked.armor(), p: v.keyPassword });
				const iv = crypto.getRandomValues(new Uint8Array(12));
				wrappedPrivateKey = new Uint8Array(
					await crypto.subtle.encrypt(
						{ name: 'AES-GCM', iv: iv as BufferSource },
						v.wrapKey,
						new TextEncoder().encode(payload) as BufferSource
					)
				);
				wrapIv = iv;
			}
			const updated: VaultRecord = {
				...prev,
				armoredEncryptedPrivateKey: args.encryptedPrivateKey,
				wrappedPrivateKey,
				wrapIv,
				updatedAt: Date.now()
			};
			await putVault(updated);
			cachedRecords.set(args.accountId, updated);
		}
		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true };
	} catch (err) {
		console.warn('keystore: commitReformattedKey failed', err);
		return { ok: false, code: 'invalid' };
	}
}

async function handleEncrypt(args: EncryptArgs): Promise<EncryptResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	let recipientKey;
	try {
		recipientKey = await openpgp.readKey({ armoredKey: args.recipientPublicKeyArmored });
	} catch (err) {
		console.warn('keystore: encrypt invalid recipient key', err);
		return { ok: false, code: 'invalid_recipient_key' };
	}
	try {
		const message = await openpgp.createMessage({ binary: args.plaintext });
		const signWith = args.signWithVaultKey ?? true;
		const signingKey = aliasSigningKey(v, args.aliasId);
		if (signWith && !signingKey) {
			return { ok: false, code: 'locked' };
		}
		const ciphertext = await openpgp.encrypt({
			message,
			encryptionKeys: recipientKey,
			signingKeys: signWith ? (signingKey as openpgp.PrivateKey) : undefined,
			format: 'binary'
		});
		return { ok: true, ciphertext: ciphertext as Uint8Array };
	} catch (err) {
		console.warn('keystore: encrypt failed', err);
		return { ok: false, code: 'unknown' };
	}
}

async function handleEncryptToKeys(args: EncryptToKeysArgs): Promise<EncryptToKeysResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (args.recipientPublicKeysArmored.length === 0) {
		return { ok: false, code: 'no_recipients' };
	}
	let recipientKeys;
	try {
		recipientKeys = await Promise.all(
			args.recipientPublicKeysArmored.map((armoredKey) => openpgp.readKey({ armoredKey }))
		);
	} catch (err) {
		console.warn('keystore: encryptToKeys invalid recipient key', err);
		return { ok: false, code: 'invalid_recipient_key' };
	}
	try {
		const message = await openpgp.createMessage({ binary: args.plaintext });
		const signWith = args.signWithVaultKey ?? true;
		const signingKey = aliasSigningKey(v, args.aliasId);
		if (signWith && !signingKey) {
			return { ok: false, code: 'locked' };
		}
		const armored = await openpgp.encrypt({
			message,
			encryptionKeys: recipientKeys,
			signingKeys: signWith ? (signingKey as openpgp.PrivateKey) : undefined,
			format: 'armored'
		});
		return { ok: true, armored: armored as string };
	} catch (err) {
		console.warn('keystore: encryptToKeys failed', err);
		return { ok: false, code: 'unknown' };
	}
}

interface PgpVerification {
	keyID: { toHex(): string };
	verified: Promise<true>;
	signature: Promise<openpgp.Signature>;
}

async function verdictFor(
	signatures: PgpVerification[],
	keys: openpgp.PublicKey[]
): Promise<SignatureVerdict> {
	if (signatures.length === 0) return { state: 'none' };
	let sawUnknownKey = false;
	for (const sig of signatures) {
		const keyID = sig.keyID.toHex().toLowerCase();
		const match = keys.find((k) =>
			k.getKeys().some((sub) => sub.getKeyID().toHex().toLowerCase() === keyID)
		);
		if (!match) {
			sawUnknownKey = true;
			continue;
		}
		try {
			await sig.verified;
		} catch {
			return { state: 'invalid', keyFingerprintHex: match.getFingerprint().toLowerCase() };
		}
		let signedAtMillis: number | undefined;
		try {
			const parsed = await sig.signature;
			signedAtMillis = parsed.packets[0]?.created?.getTime();
		} catch {
			signedAtMillis = undefined;
		}
		return {
			state: 'valid',
			keyFingerprintHex: match.getFingerprint().toLowerCase(),
			signedAtMillis
		};
	}
	return sawUnknownKey ? { state: 'unknown_key' } : { state: 'none' };
}

async function handleDecrypt(args: DecryptArgs): Promise<DecryptResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!args.ciphertextArmored && !args.ciphertextBinary) {
		return { ok: false, code: 'invalid_ciphertext' };
	}
	let verificationKeys: openpgp.PublicKey[] = [];
	if (args.verificationKeysArmored?.length) {
		try {
			verificationKeys = (await Promise.all(
				args.verificationKeysArmored.map((armoredKey) => openpgp.readKey({ armoredKey }))
			)) as openpgp.PublicKey[];
		} catch (err) {
			console.warn('keystore: decrypt invalid verification key', err);
			verificationKeys = [];
		}
	}
	const wanted = args.verificationKeysArmored?.length ? true : false;
	// A shared alias message is sealed to the alias key, not the account key.
	// The hint tells us which one; without it, let openpgp pick by key id.
	let decryptionKeys: openpgp.PrivateKey | openpgp.PrivateKey[] = v.privateKey;
	if (v.aliasKeys.size) {
		const hint = args.keyFingerprintHex?.toLowerCase();
		const hinted = hint ? v.aliasKeys.get(hint) : undefined;
		if (hinted) {
			decryptionKeys = hinted.privateKey;
		} else if (!hint || hint !== fingerprintHexOf(v.privateKey)) {
			decryptionKeys = [v.privateKey, ...[...v.aliasKeys.values()].map((e) => e.privateKey)];
		}
	}
	try {
		const message = args.ciphertextArmored
			? await openpgp.readMessage({ armoredMessage: args.ciphertextArmored })
			: await openpgp.readMessage({ binaryMessage: args.ciphertextBinary as Uint8Array });
		if (args.binary) {
			const { data, signatures } = await openpgp.decrypt({
				message,
				decryptionKeys,
				verificationKeys: verificationKeys.length ? verificationKeys : undefined,
				expectSigned: false,
				format: 'binary'
			});
			if (!(data instanceof Uint8Array)) {
				return { ok: false, code: 'invalid_ciphertext' };
			}
			return {
				ok: true,
				plaintextBinary: data,
				signature: wanted ? await verdictFor(signatures, verificationKeys) : undefined
			};
		}
		const { data, signatures } = await openpgp.decrypt({
			message,
			decryptionKeys,
			verificationKeys: verificationKeys.length ? verificationKeys : undefined,
			expectSigned: false
		});
		if (typeof data !== 'string') {
			return { ok: false, code: 'invalid_ciphertext' };
		}
		return {
			ok: true,
			plaintext: data,
			signature: wanted ? await verdictFor(signatures, verificationKeys) : undefined
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/no decryption key|session key decryption failed/i.test(msg)) {
			return { ok: false, code: 'no_matching_key' };
		}
		if (/armor|message|read|decrypt/i.test(msg)) {
			return { ok: false, code: 'invalid_ciphertext' };
		}
		console.warn('keystore: decrypt failed', err);
		return { ok: false, code: 'unknown' };
	}
}

async function handleDisablePersistent(args: DisablePersistentArgs): Promise<void> {
	const rec = cachedRecords.get(args.accountId);
	if (!rec) return;
	const updated: VaultRecord = {
		accountId: rec.accountId,
		email: rec.email,
		authScheme: rec.authScheme,
		srpSalt: rec.srpSalt,
		keySalt: rec.keySalt,
		wrappedMasterKey: rec.wrappedMasterKey,
		masterKeyId: rec.masterKeyId,
		opaqueParamsVersion: rec.opaqueParamsVersion,
		armoredEncryptedPrivateKey: rec.armoredEncryptedPrivateKey,
		updatedAt: Date.now()
	};
	await putVault(updated);
	cachedRecords.set(rec.accountId, updated);
	broadcast({ type: 'persistentDisabled', accountId: rec.accountId });
}

interface OpaqueOperation {
	kind:
		| 'register'
		| 'login'
		| 'migrationStage'
		| 'recoverySetup'
		| 'recoveryLogin'
		| 'passwordChange'
		| 'amkRotation';
	at: number;
	clientState?: string;
	password?: string;
	email?: string;
	accountId?: string;
	recovery?: boolean;
	privateKeyObj?: openpgp.PrivateKey;
	publicKeyArmored?: string;
	armoredEncryptedPrivateKey?: string;
	amk?: Uint8Array;
	exportKey?: Uint8Array;
	wrappedMasterKeyB64?: string;
	masterKeyIdB64?: string;
}

function newOpaqueOperationId(): string {
	return crypto.randomUUID();
}

function wipeOpaqueOperation(op: OpaqueOperation): void {
	op.amk?.fill(0);
	op.exportKey?.fill(0);
	op.amk = undefined;
	op.exportKey = undefined;
	op.password = undefined;
	op.clientState = undefined;
	op.privateKeyObj = undefined;
	op.armoredEncryptedPrivateKey = undefined;
}

function reapOpaqueOps(): void {
	const cutoff = Date.now() - OPAQUE_OP_TTL_MS;
	for (const [id, op] of opaqueOps) {
		if (op.at < cutoff) {
			wipeOpaqueOperation(op);
			opaqueOps.delete(id);
		}
	}
}

setInterval(reapOpaqueOps, OPAQUE_OP_TTL_MS / 4);

function toOpaqueWire(b64: string): string {
	return bytesToBase64Url(opaqueBase64ToBytes(b64));
}

function fromOpaqueWire(opaqueB64Url: string): string {
	return opaqueBytesToBase64(base64UrlToBytes(opaqueB64Url));
}

function handleOpaqueAbandonOperation(args: OpaqueAbandonOperationArgs): void {
	const op = opaqueOps.get(args.operationId);
	if (op) {
		wipeOpaqueOperation(op);
		opaqueOps.delete(args.operationId);
	}
}

async function handleOpaqueStartRegistration(
	args: OpaqueStartRegistrationArgs
): Promise<OpaqueStartRegistrationResponse> {
	await opaqueReady;
	reapOpaqueOps();
	const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
		password: args.password
	});
	const operationId = newOpaqueOperationId();
	opaqueOps.set(operationId, {
		kind: 'register',
		at: Date.now(),
		clientState: clientRegistrationState,
		password: args.password,
		email: args.email
	});
	return { operationId, registrationRequest: fromOpaqueWire(registrationRequest) };
}

async function handleOpaqueFinishRegistration(
	args: OpaqueFinishRegistrationArgs
): Promise<OpaqueFinishRegistrationResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || op.kind !== 'register' || !op.clientState || !op.password || !op.email) {
		return { ok: false, code: 'no_pending_operation' };
	}
	await opaqueReady;
	const { registrationRecord, exportKey } = opaqueClient.finishRegistration({
		password: op.password,
		registrationResponse: toOpaqueWire(args.registrationResponse),
		clientRegistrationState: op.clientState,
		identifiers: { client: clientIdentity(args.accountId, false), server: SERVER_IDENTITY },
		keyStretching: KEY_STRETCHING
	});

	const { publicKey: pubObj, privateKey: privObj } = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ email: op.email }],
		format: 'object'
	});
	const publicKeyArmored = pubObj.armor();

	const amk = generateAMK();
	const exportKeyBytes = base64UrlToBytes(exportKey);
	const wrappedMasterKey = await wrapMasterKey(exportKeyBytes, amk, false);
	const masterKeyId = await deriveMasterKeyId(amk);
	const pgpPassphrase = await derivePgpPassphrase(amk);
	const encryptedPriv = await openpgp.encryptKey({ privateKey: privObj, passphrase: pgpPassphrase });
	const armoredEncrypted = encryptedPriv.armor();
	exportKeyBytes.fill(0);

	op.accountId = args.accountId;
	op.privateKeyObj = privObj;
	op.publicKeyArmored = publicKeyArmored;
	op.armoredEncryptedPrivateKey = armoredEncrypted;
	op.amk = amk;
	op.wrappedMasterKeyB64 = opaqueBytesToBase64(wrappedMasterKey);
	op.masterKeyIdB64 = opaqueBytesToBase64(masterKeyId);

	return {
		ok: true,
		opaqueRecord: fromOpaqueWire(registrationRecord),
		wrappedMasterKey: op.wrappedMasterKeyB64,
		masterKeyId: op.masterKeyIdB64,
		opaqueParamsVersion: OPAQUE_PARAMS_VERSION,
		publicKey: publicKeyArmored,
		encryptedPrivateKey: armoredEncrypted,
		keyAlgorithm: 'openpgp-curve25519-v6'
	};
}

async function handleOpaqueFinalizeRegister(
	args: OpaqueFinalizeRegisterArgs
): Promise<OpaqueFinalizeRegisterResponse> {
	const op = opaqueOps.get(args.operationId);
	if (
		!op ||
		op.kind !== 'register' ||
		!op.privateKeyObj ||
		!op.armoredEncryptedPrivateKey ||
		!op.wrappedMasterKeyB64 ||
		!op.masterKeyIdB64 ||
		!op.email
	) {
		return { ok: false, code: 'no_pending_operation' };
	}
	opaqueOps.delete(args.operationId);
	try {
		const record: VaultRecord = {
			accountId: args.accountId,
			email: op.email,
			authScheme: 'opaque_v1',
			wrappedMasterKey: op.wrappedMasterKeyB64,
			masterKeyId: op.masterKeyIdB64,
			opaqueParamsVersion: OPAQUE_PARAMS_VERSION,
			armoredEncryptedPrivateKey: op.armoredEncryptedPrivateKey,
			updatedAt: Date.now()
		};
		await putVault(record);
		cachedRecords.set(args.accountId, record);

		const v: VaultState = {
			accountId: args.accountId,
			email: op.email,
			authScheme: 'opaque_v1',
			wrappedMasterKey: op.wrappedMasterKeyB64,
			masterKeyId: op.masterKeyIdB64,
			opaqueParamsVersion: OPAQUE_PARAMS_VERSION,
			masterKey: op.amk,
			armoredEncryptedPrivateKey: op.armoredEncryptedPrivateKey,
			privateKey: op.privateKeyObj,
			keyPassword: await derivePgpPassphrase(op.amk as Uint8Array),
			aliasKeys: new Map(),
			aliasCurrent: new Map()
		};
		vaults.set(args.accountId, v);

		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true, accountId: v.accountId, email: v.email };
	} catch (err) {
		wipeOpaqueOperation(op);
		console.warn('keystore: opaqueFinalizeRegister failed', err);
		return { ok: false, code: 'unwrap_failed' };
	}
}

async function handleOpaqueStartAuth(args: OpaqueStartAuthArgs): Promise<OpaqueStartAuthResponse> {
	await opaqueReady;
	reapOpaqueOps();
	const { clientLoginState, startLoginRequest } = opaqueClient.startLogin({ password: args.password });
	const operationId = newOpaqueOperationId();
	opaqueOps.set(operationId, {
		kind: args.recovery ? 'recoveryLogin' : 'login',
		at: Date.now(),
		clientState: clientLoginState,
		password: args.password,
		email: args.email,
		recovery: args.recovery ?? false
	});
	return { operationId, ke1: fromOpaqueWire(startLoginRequest) };
}

async function handleOpaqueFinishAuth(args: OpaqueFinishAuthArgs): Promise<OpaqueFinishAuthResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || !op.clientState || !op.password) {
		return { ok: false, code: 'no_pending_operation' };
	}
	await opaqueReady;
	const recovery = args.recovery ?? op.recovery ?? false;
	const result = opaqueClient.finishLogin({
		clientLoginState: op.clientState,
		loginResponse: toOpaqueWire(args.ke2),
		password: op.password,
		identifiers: { client: clientIdentity(args.accountId, recovery), server: SERVER_IDENTITY },
		keyStretching: KEY_STRETCHING
	});
	if (!result) {
		wipeOpaqueOperation(op);
		opaqueOps.delete(args.operationId);
		return { ok: false, code: 'invalid_credentials' };
	}
	op.accountId = args.accountId;
	op.exportKey = base64UrlToBytes(result.exportKey);
	op.at = Date.now();
	return { ok: true, ke3: fromOpaqueWire(result.finishLoginRequest) };
}

async function handleOpaqueCompleteLoginUnlock(
	args: OpaqueCompleteLoginUnlockArgs
): Promise<OpaqueCompleteLoginUnlockResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || !op.exportKey || op.accountId !== args.accountId) {
		return { ok: false, code: 'no_pending_operation' };
	}
	opaqueOps.delete(args.operationId);
	try {
		const wrappedMasterKey = opaqueBase64ToBytes(args.wrappedMasterKey);
		const amk = await unwrapMasterKey(op.exportKey, wrappedMasterKey, false);
		const derivedMasterKeyId = opaqueBytesToBase64(await deriveMasterKeyId(amk));
		if (!constantTimeEqual(derivedMasterKeyId, args.masterKeyId)) {
			amk.fill(0);
			wipeOpaqueOperation(op);
			return { ok: false, code: 'master_key_mismatch' };
		}
		const pgpPassphrase = await derivePgpPassphrase(amk);
		const privateKey = await openpgp.readPrivateKey({ armoredKey: args.encryptedPrivateKey });
		const unlocked = await openpgp.decryptKey({ privateKey, passphrase: pgpPassphrase });

		const record: VaultRecord = {
			accountId: args.accountId,
			email: op.email ?? '',
			authScheme: args.serverAuthScheme,
			wrappedMasterKey: args.wrappedMasterKey,
			masterKeyId: args.masterKeyId,
			opaqueParamsVersion: args.opaqueParamsVersion,
			armoredEncryptedPrivateKey: args.encryptedPrivateKey,
			updatedAt: Date.now()
		};
		await putVault(record);
		cachedRecords.set(args.accountId, record);

		const v: VaultState = {
			accountId: args.accountId,
			email: op.email ?? '',
			authScheme: args.serverAuthScheme,
			wrappedMasterKey: args.wrappedMasterKey,
			masterKeyId: args.masterKeyId,
			opaqueParamsVersion: args.opaqueParamsVersion,
			masterKey: amk,
			armoredEncryptedPrivateKey: args.encryptedPrivateKey,
			privateKey: unlocked,
			keyPassword: pgpPassphrase,
			aliasKeys: new Map(),
			aliasCurrent: new Map()
		};
		vaults.set(args.accountId, v);

		wipeOpaqueOperation(op);
		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true, accountId: v.accountId, email: v.email };
	} catch (err) {
		wipeOpaqueOperation(op);
		console.warn('keystore: opaqueCompleteLoginUnlock failed', err);
		return { ok: false, code: 'unwrap_failed' };
	}
}

async function handleMigrationStartRegistration(
	args: MigrationStartRegistrationArgs
): Promise<MigrationStartRegistrationResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	await opaqueReady;
	reapOpaqueOps();
	const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
		password: args.password
	});
	const operationId = newOpaqueOperationId();
	opaqueOps.set(operationId, {
		kind: 'migrationStage',
		at: Date.now(),
		clientState: clientRegistrationState,
		password: args.password,
		accountId: args.accountId,
		email: v.email
	});
	return { ok: true, operationId, registrationRequest: fromOpaqueWire(registrationRequest) };
}

async function handleMigrationFinishStage(
	args: MigrationFinishStageArgs
): Promise<MigrationFinishStageResponse> {
	const op = opaqueOps.get(args.operationId);
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!op || op.kind !== 'migrationStage' || !op.clientState || !op.password) {
		return { ok: false, code: 'no_pending_operation' };
	}
	await opaqueReady;
	const { registrationRecord, exportKey } = opaqueClient.finishRegistration({
		password: op.password,
		registrationResponse: toOpaqueWire(args.registrationResponse),
		clientRegistrationState: op.clientState,
		identifiers: { client: clientIdentity(args.accountId, false), server: SERVER_IDENTITY },
		keyStretching: KEY_STRETCHING
	});
	opaqueOps.delete(args.operationId);

	const amk = generateAMK();
	const exportKeyBytes = base64UrlToBytes(exportKey);
	const wrappedMasterKey = await wrapMasterKey(exportKeyBytes, amk, false);
	exportKeyBytes.fill(0);
	const masterKeyId = await deriveMasterKeyId(amk);
	const pgpPassphrase = await derivePgpPassphrase(amk);
	const stagedEncrypted = await openpgp.encryptKey({ privateKey: v.privateKey, passphrase: pgpPassphrase });
	amk.fill(0);

	return {
		ok: true,
		opaqueRecord: fromOpaqueWire(registrationRecord),
		wrappedMasterKey: opaqueBytesToBase64(wrappedMasterKey),
		masterKeyId: opaqueBytesToBase64(masterKeyId),
		opaqueParamsVersion: OPAQUE_PARAMS_VERSION,
		stagedEncryptedPrivateKey: stagedEncrypted.armor()
	};
}

async function handleOpaqueRecoverySetupStart(
	args: OpaqueRecoverySetupStartArgs
): Promise<OpaqueRecoverySetupStartResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	await opaqueReady;
	reapOpaqueOps();
	const phrase = generateMnemonic(wordlist, 128);
	const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
		password: phrase
	});
	const operationId = newOpaqueOperationId();
	opaqueOps.set(operationId, {
		kind: 'recoverySetup',
		at: Date.now(),
		clientState: clientRegistrationState,
		password: phrase,
		accountId: args.accountId
	});
	return { ok: true, operationId, phrase, registrationRequest: fromOpaqueWire(registrationRequest) };
}

async function handleOpaqueRecoverySetupFinish(
	args: OpaqueRecoverySetupFinishArgs
): Promise<OpaqueRecoverySetupFinishResponse> {
	const op = opaqueOps.get(args.operationId);
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!op || op.kind !== 'recoverySetup' || !op.clientState || !op.password || !v.masterKey) {
		return { ok: false, code: 'no_pending_operation' };
	}
	await opaqueReady;
	const { registrationRecord, exportKey } = opaqueClient.finishRegistration({
		password: op.password,
		registrationResponse: toOpaqueWire(args.registrationResponse),
		clientRegistrationState: op.clientState,
		identifiers: { client: clientIdentity(args.accountId, true), server: SERVER_IDENTITY },
		keyStretching: KEY_STRETCHING
	});
	opaqueOps.delete(args.operationId);

	const exportKeyBytes = base64UrlToBytes(exportKey);
	const wrappedMasterKey = await wrapMasterKey(exportKeyBytes, v.masterKey, true);
	exportKeyBytes.fill(0);
	const masterKeyId = await deriveMasterKeyId(v.masterKey);

	return {
		ok: true,
		opaqueRecord: fromOpaqueWire(registrationRecord),
		wrappedMasterKey: opaqueBytesToBase64(wrappedMasterKey),
		masterKeyId: opaqueBytesToBase64(masterKeyId),
		opaqueParamsVersion: OPAQUE_PARAMS_VERSION
	};
}

async function handleOpaqueCompleteRecoveryUnlock(
	args: OpaqueCompleteRecoveryUnlockArgs
): Promise<OpaqueCompleteRecoveryUnlockResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || op.kind !== 'recoveryLogin' || !op.exportKey) {
		return { ok: false, code: 'no_pending_operation' };
	}
	try {
		const wrappedMasterKey = opaqueBase64ToBytes(args.wrappedMasterKey);
		const amk = await unwrapMasterKey(op.exportKey, wrappedMasterKey, true);
		const pgpPassphrase = await derivePgpPassphrase(amk);
		const privateKey = await openpgp.readPrivateKey({ armoredKey: args.encryptedPrivateKey });
		const unlocked = await openpgp.decryptKey({ privateKey, passphrase: pgpPassphrase });

		op.privateKeyObj = unlocked;
		op.amk = amk;
		op.at = Date.now();
		return { ok: true };
	} catch (err) {
		wipeOpaqueOperation(op);
		opaqueOps.delete(args.operationId);
		console.warn('keystore: opaqueCompleteRecoveryUnlock failed', err);
		return { ok: false, code: 'invalid_credentials' };
	}
}

async function handleOpaquePrepareCredentialReset(
	args: OpaquePrepareCredentialResetArgs
): Promise<OpaquePrepareCredentialResetResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || op.kind !== 'recoveryLogin' || !op.privateKeyObj || !op.amk) {
		return { ok: false, code: 'no_pending_reset' };
	}
	await opaqueReady;
	const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
		password: args.newPassword
	});
	op.clientState = clientRegistrationState;
	op.password = args.newPassword;
	op.at = Date.now();
	return { ok: true, registrationRequest: fromOpaqueWire(registrationRequest) };
}

async function handleOpaqueFinishCredentialReset(
	args: OpaqueFinishCredentialResetArgs
): Promise<OpaqueFinishCredentialResetResponse> {
	const op = opaqueOps.get(args.operationId);
	if (
		!op ||
		op.kind !== 'recoveryLogin' ||
		!op.clientState ||
		!op.password ||
		!op.amk ||
		!op.accountId
	) {
		return { ok: false, code: 'no_pending_reset' };
	}
	await opaqueReady;
	const { registrationRecord, exportKey } = opaqueClient.finishRegistration({
		password: op.password,
		registrationResponse: toOpaqueWire(args.registrationResponse),
		clientRegistrationState: op.clientState,
		identifiers: { client: clientIdentity(op.accountId, false), server: SERVER_IDENTITY },
		keyStretching: KEY_STRETCHING
	});
	const exportKeyBytes = base64UrlToBytes(exportKey);
	const wrappedMasterKey = await wrapMasterKey(exportKeyBytes, op.amk, false);
	const masterKeyId = await deriveMasterKeyId(op.amk);
	exportKeyBytes.fill(0);
	wipeOpaqueOperation(op);
	opaqueOps.delete(args.operationId);

	return {
		ok: true,
		opaqueRecord: fromOpaqueWire(registrationRecord),
		wrappedMasterKey: opaqueBytesToBase64(wrappedMasterKey),
		masterKeyId: opaqueBytesToBase64(masterKeyId),
		opaqueParamsVersion: OPAQUE_PARAMS_VERSION
	};
}

async function handleOpaquePrepareAmkRotation(
	args: OpaquePrepareAmkRotationArgs
): Promise<OpaquePrepareAmkRotationResponse> {
	if (!pendingReset) {
		return { ok: false, code: 'no_pending_reset' };
	}
	await opaqueReady;
	reapOpaqueOps();
	const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
		password: args.newPassword
	});
	const operationId = newOpaqueOperationId();
	opaqueOps.set(operationId, {
		kind: 'amkRotation',
		at: Date.now(),
		clientState: clientRegistrationState,
		password: args.newPassword,
		accountId: args.accountId
	});
	return { ok: true, operationId, registrationRequest: fromOpaqueWire(registrationRequest) };
}

async function handleOpaqueFinishAmkRotation(
	args: OpaqueFinishAmkRotationArgs
): Promise<OpaqueFinishAmkRotationResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || op.kind !== 'amkRotation' || !op.clientState || !op.password || !op.accountId) {
		return { ok: false, code: 'no_pending_operation' };
	}
	if (!pendingReset) {
		wipeOpaqueOperation(op);
		opaqueOps.delete(args.operationId);
		return { ok: false, code: 'no_pending_reset' };
	}
	const p = pendingReset;

	await opaqueReady;
	const { registrationRecord, exportKey } = opaqueClient.finishRegistration({
		password: op.password,
		registrationResponse: toOpaqueWire(args.registrationResponse),
		identifiers: { client: clientIdentity(op.accountId, false), server: SERVER_IDENTITY },
		clientRegistrationState: op.clientState,
		keyStretching: KEY_STRETCHING
	});

	const exportKeyBytes = base64UrlToBytes(exportKey);
	const amk = generateAMK();
	const wrappedMasterKey = await wrapMasterKey(exportKeyBytes, amk, false);
	const masterKeyId = await deriveMasterKeyId(amk);
	const pgpPassphrase = await derivePgpPassphrase(amk);
	const encrypted = await openpgp.encryptKey({ privateKey: p.privateKey, passphrase: pgpPassphrase });
	exportKeyBytes.fill(0);
	amk.fill(0);
	pendingReset = null;
	wipeOpaqueOperation(op);
	opaqueOps.delete(args.operationId);

	return {
		ok: true,
		opaqueRecord: fromOpaqueWire(registrationRecord),
		wrappedMasterKey: opaqueBytesToBase64(wrappedMasterKey),
		masterKeyId: opaqueBytesToBase64(masterKeyId),
		opaqueParamsVersion: OPAQUE_PARAMS_VERSION,
		encryptedPrivateKey: encrypted.armor()
	};
}

async function handleOpaquePasswordChangeStart(
	args: OpaquePasswordChangeStartArgs
): Promise<OpaquePasswordChangeStartResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	await opaqueReady;
	reapOpaqueOps();
	const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
		password: args.newPassword
	});
	const operationId = newOpaqueOperationId();
	opaqueOps.set(operationId, {
		kind: 'passwordChange',
		at: Date.now(),
		clientState: clientRegistrationState,
		password: args.newPassword,
		accountId: args.accountId
	});
	return { ok: true, operationId, registrationRequest: fromOpaqueWire(registrationRequest) };
}

async function handleOpaquePasswordChangeFinish(
	args: OpaquePasswordChangeFinishArgs
): Promise<OpaquePasswordChangeFinishResponse> {
	const op = opaqueOps.get(args.operationId);
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!op || op.kind !== 'passwordChange' || !op.clientState || !op.password || !v.masterKey) {
		return { ok: false, code: 'no_pending_operation' };
	}
	await opaqueReady;
	const { registrationRecord, exportKey } = opaqueClient.finishRegistration({
		password: op.password,
		registrationResponse: toOpaqueWire(args.registrationResponse),
		clientRegistrationState: op.clientState,
		identifiers: { client: clientIdentity(args.accountId, false), server: SERVER_IDENTITY },
		keyStretching: KEY_STRETCHING
	});

	const exportKeyBytes = base64UrlToBytes(exportKey);
	const wrappedMasterKey = await wrapMasterKey(exportKeyBytes, v.masterKey, false);
	const masterKeyId = await deriveMasterKeyId(v.masterKey);
	exportKeyBytes.fill(0);

	const wrappedMasterKeyB64 = opaqueBytesToBase64(wrappedMasterKey);
	const masterKeyIdB64 = opaqueBytesToBase64(masterKeyId);
	op.wrappedMasterKeyB64 = wrappedMasterKeyB64;
	op.masterKeyIdB64 = masterKeyIdB64;
	op.clientState = undefined;
	op.password = undefined;
	op.at = Date.now();

	return {
		ok: true,
		opaqueRecord: fromOpaqueWire(registrationRecord),
		wrappedMasterKey: wrappedMasterKeyB64,
		masterKeyId: masterKeyIdB64,
		opaqueParamsVersion: OPAQUE_PARAMS_VERSION
	};
}

async function handleOpaquePasswordChangeCommit(
	args: OpaquePasswordChangeCommitArgs
): Promise<OpaquePasswordChangeCommitResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || op.kind !== 'passwordChange' || !op.wrappedMasterKeyB64 || !op.masterKeyIdB64) {
		return { ok: false, code: 'no_pending_operation' };
	}
	const v = vaults.get(args.accountId);
	if (!v) {
		opaqueOps.delete(args.operationId);
		wipeOpaqueOperation(op);
		return { ok: false, code: 'locked' };
	}
	const wrappedMasterKeyB64 = op.wrappedMasterKeyB64;
	const masterKeyIdB64 = op.masterKeyIdB64;
	opaqueOps.delete(args.operationId);
	wipeOpaqueOperation(op);

	v.wrappedMasterKey = wrappedMasterKeyB64;
	v.masterKeyId = masterKeyIdB64;
	v.opaqueParamsVersion = OPAQUE_PARAMS_VERSION;

	let persisted = true;
	const prev = cachedRecords.get(args.accountId);
	if (prev) {
		const updated: VaultRecord = {
			...prev,
			wrappedMasterKey: wrappedMasterKeyB64,
			masterKeyId: masterKeyIdB64,
			opaqueParamsVersion: OPAQUE_PARAMS_VERSION,
			updatedAt: Date.now()
		};
		try {
			await putVault(updated);
			cachedRecords.set(args.accountId, updated);
		} catch (err) {
			console.warn('keystore: opaquePasswordChangeCommit persist failed', err);
			persisted = false;
			cachedRecords.delete(args.accountId);
			try {
				await deleteVault(args.accountId);
			} catch (delErr) {
				console.warn('keystore: opaquePasswordChangeCommit cleanup failed', delErr);
			}
		}
	}

	broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
	return { ok: true, persisted };
}

function constantTimeEqual(aB64: string, bB64: string): boolean {
	const a = atob(aB64);
	const b = atob(bB64);
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

interface RequestMessage {
	id: string;
	cmd: string;
	args?: unknown;
}

interface ResponseMessage {
	type: 'response';
	id: string;
	value?: unknown;
	error?: string;
}

function respond(port: MessagePort, id: string, value: unknown) {
	const msg: ResponseMessage = { type: 'response', id, value };
	port.postMessage(msg);
}

function respondError(port: MessagePort, id: string, error: unknown) {
	const msg: ResponseMessage = {
		type: 'response',
		id,
		error: error instanceof Error ? error.message : String(error)
	};
	port.postMessage(msg);
}

async function dispatch(port: MessagePort, msg: RequestMessage) {
	try {
		switch (msg.cmd) {
			case 'status':
				respond(port, msg.id, await handleStatus());
				break;
			case 'prepareLogin':
				respond(port, msg.id, await handlePrepareLogin(msg.args as PrepareLoginArgs));
				break;
			case 'verifyLoginProof':
				respond(port, msg.id, handleVerifyLoginProof(msg.args as VerifyLoginProofArgs));
				break;
			case 'completeLoginUnlock':
				respond(port, msg.id, await handleCompleteLoginUnlock(msg.args as CompleteLoginUnlockArgs));
				break;
			case 'abandonLogin':
				handleAbandonLogin();
				respond(port, msg.id, undefined);
				break;
			case 'opaqueStartRegistration':
				respond(
					port,
					msg.id,
					await handleOpaqueStartRegistration(msg.args as OpaqueStartRegistrationArgs)
				);
				break;
			case 'opaqueFinishRegistration':
				respond(
					port,
					msg.id,
					await handleOpaqueFinishRegistration(msg.args as OpaqueFinishRegistrationArgs)
				);
				break;
			case 'opaqueFinalizeRegister':
				respond(
					port,
					msg.id,
					await handleOpaqueFinalizeRegister(msg.args as OpaqueFinalizeRegisterArgs)
				);
				break;
			case 'opaqueStartAuth':
				respond(port, msg.id, await handleOpaqueStartAuth(msg.args as OpaqueStartAuthArgs));
				break;
			case 'opaqueFinishAuth':
				respond(port, msg.id, await handleOpaqueFinishAuth(msg.args as OpaqueFinishAuthArgs));
				break;
			case 'opaqueCompleteLoginUnlock':
				respond(
					port,
					msg.id,
					await handleOpaqueCompleteLoginUnlock(msg.args as OpaqueCompleteLoginUnlockArgs)
				);
				break;
			case 'opaqueAbandonOperation':
				handleOpaqueAbandonOperation(msg.args as OpaqueAbandonOperationArgs);
				respond(port, msg.id, undefined);
				break;
			case 'migrationStartRegistration':
				respond(
					port,
					msg.id,
					await handleMigrationStartRegistration(msg.args as MigrationStartRegistrationArgs)
				);
				break;
			case 'migrationFinishStage':
				respond(
					port,
					msg.id,
					await handleMigrationFinishStage(msg.args as MigrationFinishStageArgs)
				);
				break;
			case 'opaqueRecoverySetupStart':
				respond(
					port,
					msg.id,
					await handleOpaqueRecoverySetupStart(msg.args as OpaqueRecoverySetupStartArgs)
				);
				break;
			case 'opaqueRecoverySetupFinish':
				respond(
					port,
					msg.id,
					await handleOpaqueRecoverySetupFinish(msg.args as OpaqueRecoverySetupFinishArgs)
				);
				break;
			case 'opaqueCompleteRecoveryUnlock':
				respond(
					port,
					msg.id,
					await handleOpaqueCompleteRecoveryUnlock(msg.args as OpaqueCompleteRecoveryUnlockArgs)
				);
				break;
			case 'opaquePrepareCredentialReset':
				respond(
					port,
					msg.id,
					await handleOpaquePrepareCredentialReset(msg.args as OpaquePrepareCredentialResetArgs)
				);
				break;
			case 'opaqueFinishCredentialReset':
				respond(
					port,
					msg.id,
					await handleOpaqueFinishCredentialReset(msg.args as OpaqueFinishCredentialResetArgs)
				);
				break;
			case 'opaquePrepareAmkRotation':
				respond(
					port,
					msg.id,
					await handleOpaquePrepareAmkRotation(msg.args as OpaquePrepareAmkRotationArgs)
				);
				break;
			case 'opaqueFinishAmkRotation':
				respond(
					port,
					msg.id,
					await handleOpaqueFinishAmkRotation(msg.args as OpaqueFinishAmkRotationArgs)
				);
				break;
			case 'opaquePasswordChangeStart':
				respond(
					port,
					msg.id,
					await handleOpaquePasswordChangeStart(msg.args as OpaquePasswordChangeStartArgs)
				);
				break;
			case 'opaquePasswordChangeFinish':
				respond(
					port,
					msg.id,
					await handleOpaquePasswordChangeFinish(msg.args as OpaquePasswordChangeFinishArgs)
				);
				break;
			case 'opaquePasswordChangeCommit':
				respond(
					port,
					msg.id,
					await handleOpaquePasswordChangeCommit(msg.args as OpaquePasswordChangeCommitArgs)
				);
				break;
			case 'prepareRecoverySetup':
				respond(
					port,
					msg.id,
					await handlePrepareRecoverySetup(msg.args as PrepareRecoverySetupArgs)
				);
				break;
			case 'prepareRecoveryLogin':
				respond(
					port,
					msg.id,
					await handlePrepareRecoveryLogin(msg.args as PrepareRecoveryLoginArgs)
				);
				break;
			case 'verifyRecoveryProof':
				respond(port, msg.id, handleVerifyRecoveryProof(msg.args as VerifyRecoveryProofArgs));
				break;
			case 'completeRecoveryUnlock':
				respond(
					port,
					msg.id,
					await handleCompleteRecoveryUnlock(msg.args as CompleteRecoveryUnlockArgs)
				);
				break;
			case 'prepareCredentialReset':
				respond(
					port,
					msg.id,
					await handlePrepareCredentialReset(msg.args as PrepareCredentialResetArgs)
				);
				break;
			case 'discardRecovery':
				handleDiscardRecovery();
				respond(port, msg.id, undefined);
				break;
			case 'prepareDeletionProof':
				respond(
					port,
					msg.id,
					await handlePrepareDeletionProof(msg.args as PrepareDeletionProofArgs)
				);
				break;
			case 'preparePasswordChangeProof':
				respond(
					port,
					msg.id,
					await handlePreparePasswordChangeProof(msg.args as PreparePasswordChangeProofArgs)
				);
				break;
			case 'verifyPasswordChangeProof':
				respond(
					port,
					msg.id,
					handleVerifyPasswordChangeProof(msg.args as VerifyPasswordChangeProofArgs)
				);
				break;
			case 'preparePasswordChangeCredentials':
				respond(
					port,
					msg.id,
					await handlePreparePasswordChangeCredentials(
						msg.args as PreparePasswordChangeCredentialsArgs
					)
				);
				break;
			case 'commitPasswordChange':
				respond(
					port,
					msg.id,
					await handleCommitPasswordChange(msg.args as CommitPasswordChangeArgs)
				);
				break;
			case 'invalidatePersistedVault':
				await handleInvalidatePersistedVault(msg.args as InvalidatePersistedVaultArgs);
				respond(port, msg.id, undefined);
				break;
			case 'abandonPasswordChange':
				handleAbandonPasswordChange();
				respond(port, msg.id, undefined);
				break;
			case 'lock':
				handleLock(msg.args as LockArgs);
				respond(port, msg.id, undefined);
				break;
			case 'clear':
				await handleClear(msg.args as ClearArgs);
				respond(port, msg.id, undefined);
				break;
			case 'clearAll':
				await handleClearAll();
				respond(port, msg.id, undefined);
				break;
			case 'enrollPersistent':
				respond(port, msg.id, await handleEnrollPersistent(msg.args as EnrollPersistentArgs));
				break;
			case 'tryRestoreFromPersistent':
				respond(
					port,
					msg.id,
					await handleTryRestoreFromPersistent(msg.args as TryRestoreFromPersistentArgs)
				);
				break;
			case 'disablePersistent':
				await handleDisablePersistent(msg.args as DisablePersistentArgs);
				respond(port, msg.id, undefined);
				break;
			case 'decrypt':
				respond(port, msg.id, await handleDecrypt(msg.args as DecryptArgs));
				break;
			case 'loadAliasKeys':
				respond(port, msg.id, await handleLoadAliasKeys(msg.args as LoadAliasKeysArgs));
				break;
			case 'unloadAliasKeys':
				handleUnloadAliasKeys(msg.args as UnloadAliasKeysArgs);
				respond(port, msg.id, undefined);
				break;
			case 'createAliasKey':
				respond(port, msg.id, await handleCreateAliasKey(msg.args as CreateAliasKeyArgs));
				break;
			case 'getPublicKey':
				respond(port, msg.id, await handleGetPublicKey(msg.args as GetPublicKeyArgs));
				break;
			case 'reformatKeyWithUids':
				respond(
					port,
					msg.id,
					await handleReformatKeyWithUids(msg.args as ReformatKeyWithUidsArgs)
				);
				break;
			case 'commitReformattedKey':
				respond(
					port,
					msg.id,
					await handleCommitReformattedKey(msg.args as CommitReformattedKeyArgs)
				);
				break;
			case 'encrypt':
				respond(port, msg.id, await handleEncrypt(msg.args as EncryptArgs));
				break;
			case 'encryptToKeys':
				respond(port, msg.id, await handleEncryptToKeys(msg.args as EncryptToKeysArgs));
				break;
			default:
				respondError(port, msg.id, `unknown command: ${msg.cmd}`);
		}
	} catch (err) {
		respondError(port, msg.id, err);
	}
}

self.onconnect = (event: MessageEvent) => {
	const port = event.ports[0];
	ports.add(port);
	port.onmessage = (ev: MessageEvent<RequestMessage>) => {
		void dispatch(port, ev.data);
	};
	port.start?.();
};
