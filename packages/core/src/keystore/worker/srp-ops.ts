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
import { deleteVault, putVault } from '../idb';
import type { VaultRecord } from '../idb';
import type {
	CommitPasswordChangeArgs,
	CommitPasswordChangeResponse,
	CompleteRecoveryUnlockArgs,
	CompleteRecoveryUnlockResponse,
	PrepareCredentialResetArgs,
	PrepareCredentialResetResponse,
	PrepareDeletionProofArgs,
	PrepareDeletionProofResponse,
	PreparePasswordChangeCredentialsArgs,
	PreparePasswordChangeCredentialsResponse,
	PreparePasswordChangeProofArgs,
	PreparePasswordChangeProofResponse,
	PrepareRecoveryLoginArgs,
	PrepareRecoveryLoginResponse,
	PrepareRecoverySetupArgs,
	PrepareRecoverySetupResponse,
	VerifyPasswordChangeProofArgs,
	VerifyPasswordChangeProofResponse,
	VerifyRecoveryProofArgs,
	VerifyRecoveryProofResponse
} from '../protocol';
import {
	PENDING_LOGIN_TTL_MS,
	vaults,
	cachedRecords,
	ensureCryptoReady,
	broadcast,
	wipe,
	constantTimeEqual,
	pendingFlows
} from './state';

export {
	handleAbandonLogin,
	handleCompleteLoginUnlock,
	handleMigrationFinalized,
	handleMigrationFinishStage,
	handleMigrationStartRegistration,
	handlePrepareLogin,
	handleVerifyLoginProof
} from './srp-login';

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
