/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { lockKey } from '$core/keys/pgpKeys';
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
import { deleteVault, getVault, putVault } from '../idb';
import type { VaultRecord } from '../idb';
import {
	KEY_STRETCHING,
	OPAQUE_PARAMS_VERSION,
	SERVER_IDENTITY,
	base64UrlToBytes,
	bytesToBase64 as opaqueBytesToBase64,
	clientIdentity,
	deriveMasterKeyId,
	derivePgpPassphrase,
	generateAMK,
	wrapMasterKey
} from '../opaque-params';
import type {
	CommitPasswordChangeArgs,
	CommitPasswordChangeResponse,
	CompleteLoginUnlockArgs,
	CompleteLoginUnlockResponse,
	CompleteRecoveryUnlockArgs,
	CompleteRecoveryUnlockResponse,
	MigrationFinishStageArgs,
	MigrationFinalizedArgs,
	MigrationFinalizedResponse,
	MigrationFinishStageResponse,
	MigrationStartRegistrationArgs,
	MigrationStartRegistrationResponse,
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
	VerifyLoginProofArgs,
	VerifyLoginProofResponse,
	VerifyPasswordChangeProofArgs,
	VerifyPasswordChangeProofResponse,
	VerifyRecoveryProofArgs,
	VerifyRecoveryProofResponse
} from '../protocol';
import type { VaultState } from './state';
import {
	PENDING_LOGIN_TTL_MS,
	vaults,
	cachedRecords,
	opaqueOps,
	ensureCryptoReady,
	broadcast,
	wipe,
	storedAccountKeys,
	seedAccountKeys,
	constantTimeEqual,
	pendingFlows
} from './state';
import {
	newOpaqueOperationId,
	reapOpaqueOps,
	toOpaqueWire,
	fromOpaqueWire
} from './opaque-account';

export async function handlePrepareLogin(args: PrepareLoginArgs): Promise<PrepareLoginResponse> {
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
	pendingFlows.login = {
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

export function handleVerifyLoginProof(args: VerifyLoginProofArgs): VerifyLoginProofResponse {
	const pending = pendingFlows.login;
	if (!pending) {
		return { ok: false, code: 'no_pending_login' };
	}
	if (!constantTimeEqual(args.serverProof, pending.expectedServerProof)) {
		wipe(pending.password);
		pendingFlows.login = null;
		return { ok: false, code: 'invalid_credentials' };
	}
	pending.proofVerified = true;
	pending.verifiedAt = Date.now();
	return { ok: true };
}

export function handleAbandonLogin(): void {
	if (pendingFlows.login) {
		wipe(pendingFlows.login.password);
		pendingFlows.login = null;
	}
}

export async function handleCompleteLoginUnlock(
	args: CompleteLoginUnlockArgs
): Promise<CompleteLoginUnlockResponse> {
	const pending = pendingFlows.login;
	if (!pending) {
		return { ok: false, code: 'no_pending_login' };
	}
	if (!pending.proofVerified || pending.verifiedAt === null) {
		return { ok: false, code: 'proof_not_verified' };
	}
	if (Date.now() - pending.verifiedAt > PENDING_LOGIN_TTL_MS) {
		wipe(pending.password);
		pendingFlows.login = null;
		return { ok: false, code: 'no_pending_login' };
	}
	pendingFlows.login = null;

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
			accountKeys: new Map(),
			keyVersion: 1,
			aliasKeys: new Map(),
			aliasCurrent: new Map()
		};
		await seedAccountKeys(v);
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

export async function handlePrepareRecoverySetup(
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
	const encrypted = await lockKey(v.privateKey, passphrase);

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

export async function handlePrepareRecoveryLogin(
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
	pendingFlows.recoveryLogin = {
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

export function handleVerifyRecoveryProof(args: VerifyRecoveryProofArgs): VerifyRecoveryProofResponse {
	const pending = pendingFlows.recoveryLogin;
	if (!pending) {
		return { ok: false, code: 'no_pending_recovery' };
	}
	if (!constantTimeEqual(args.serverProof, pending.expectedServerProof)) {
		wipe(pending.phrase);
		pendingFlows.recoveryLogin = null;
		return { ok: false, code: 'invalid_credentials' };
	}
	pending.proofVerified = true;
	pending.verifiedAt = Date.now();
	return { ok: true };
}

export async function handleCompleteRecoveryUnlock(
	args: CompleteRecoveryUnlockArgs
): Promise<CompleteRecoveryUnlockResponse> {
	const pending = pendingFlows.recoveryLogin;
	if (!pending) {
		return { ok: false, code: 'no_pending_recovery' };
	}
	if (!pending.proofVerified || pending.verifiedAt === null) {
		return { ok: false, code: 'proof_not_verified' };
	}
	if (Date.now() - pending.verifiedAt > PENDING_LOGIN_TTL_MS) {
		wipe(pending.phrase);
		pendingFlows.recoveryLogin = null;
		return { ok: false, code: 'no_pending_recovery' };
	}
	pendingFlows.recoveryLogin = null;

	try {
		const passphrase = await computeKeyPassword(pending.phrase, args.keySalt);
		const privateKey = await openpgp.readPrivateKey({ armoredKey: args.encryptedPrivateKey });
		const unlocked = await openpgp.decryptKey({ privateKey, passphrase });

		pendingFlows.reset = {
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

export async function handlePrepareCredentialReset(
	args: PrepareCredentialResetArgs
): Promise<PrepareCredentialResetResponse> {
	const p = pendingFlows.reset;
	if (!p) {
		return { ok: false, code: 'no_pending_reset' };
	}
	if (Date.now() > p.expiresAt) {
		pendingFlows.reset = null;
		return { ok: false, code: 'reset_expired' };
	}
	await ensureCryptoReady();

	const keySalt = generateKeySalt();
	const passphrase = await computeKeyPassword(args.newPassword, keySalt);
	const encrypted = await lockKey(p.privateKey, passphrase);

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

export function handleDiscardRecovery(): void {
	pendingFlows.recoveryLogin = null;
	pendingFlows.reset = null;
}

export async function handlePrepareDeletionProof(
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

export async function handlePreparePasswordChangeProof(
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
	pendingFlows.passwordChange = {
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

export function handleVerifyPasswordChangeProof(
	args: VerifyPasswordChangeProofArgs
): VerifyPasswordChangeProofResponse {
	const pending = pendingFlows.passwordChange;
	if (!pending) {
		return { ok: false, code: 'no_pending_change' };
	}
	if (!constantTimeEqual(args.serverProof, pending.expectedServerProof)) {
		pendingFlows.passwordChange = null;
		return { ok: false, code: 'invalid_credentials' };
	}
	pending.proofVerified = true;
	pending.verifiedAt = Date.now();
	return { ok: true };
}

export async function handlePreparePasswordChangeCredentials(
	args: PreparePasswordChangeCredentialsArgs
): Promise<PreparePasswordChangeCredentialsResponse> {
	const pending = pendingFlows.passwordChange;
	if (!pending || pending.accountId !== args.accountId) {
		return { ok: false, code: 'no_pending_change' };
	}
	if (!pending.proofVerified || pending.verifiedAt === null) {
		return { ok: false, code: 'proof_not_verified' };
	}
	if (Date.now() - pending.verifiedAt > PENDING_LOGIN_TTL_MS) {
		pendingFlows.passwordChange = null;
		return { ok: false, code: 'change_expired' };
	}
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	await ensureCryptoReady();

	const keySalt = generateKeySalt();
	const passphrase = await computeKeyPassword(args.newPassword, keySalt);
	const encrypted = await lockKey(v.privateKey, passphrase);
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

export async function handleCommitPasswordChange(
	args: CommitPasswordChangeArgs
): Promise<CommitPasswordChangeResponse> {
	const pending = pendingFlows.passwordChange;
	if (!pending || pending.accountId !== args.accountId || !pending.newCredentials) {
		return { ok: false, code: 'no_pending_change' };
	}
	const v = vaults.get(args.accountId);
	if (!v) {
		pendingFlows.passwordChange = null;
		return { ok: false, code: 'locked' };
	}
	const creds = pending.newCredentials;
	pendingFlows.passwordChange = null;

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

export function handleAbandonPasswordChange(): void {
	pendingFlows.passwordChange = null;
}

export async function handleMigrationStartRegistration(
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

export async function handleMigrationFinishStage(
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
	const stagedEncrypted = await lockKey(v.privateKey, pgpPassphrase);
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

export async function handleMigrationFinalized(
	args: MigrationFinalizedArgs
): Promise<MigrationFinalizedResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (v.authScheme !== 'srp_v1' || !v.masterKey || !v.wrappedMasterKey || !v.masterKeyId) {
		return { ok: false, code: 'not_staged' };
	}
	const previous = cachedRecords.get(args.accountId) ?? (await getVault(args.accountId)) ?? undefined;
	v.authScheme = 'opaque_v1';
	await seedAccountKeys(v, previous);
	if (previous) {
		const persisted: VaultRecord = {
			...previous,
			authScheme: 'opaque_v1',
			...storedAccountKeys(v),
			updatedAt: Date.now()
		};
		await putVault(persisted);
		cachedRecords.set(args.accountId, persisted);
	}
	broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
	return { ok: true };
}
