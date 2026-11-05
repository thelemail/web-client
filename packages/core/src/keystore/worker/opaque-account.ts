/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { generateCurve25519Key, lockKey } from '$core/keys/pgpKeys';
import { OPAQUE_OP_TTL_MS, settleLogin, wipeOpaqueOperation } from '../opaque-ops';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { deleteVault, getVault, putVault } from '../idb';
import type { VaultRecord } from '../idb';
import {
	KEY_STRETCHING,
	OPAQUE_PARAMS_VERSION,
	SERVER_IDENTITY,
	base64ToBytes as opaqueBase64ToBytes,
	base64UrlToBytes,
	bytesToBase64 as opaqueBytesToBase64,
	bytesToBase64Url,
	clientIdentity,
	deriveMasterKeyId,
	derivePgpPassphrase,
	generateAMK,
	keyCreationDate,
	unwrapMasterKey,
	wrapMasterKey
} from '../opaque-params';
import type {
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
	OpaqueStartRegistrationResponse
} from '../protocol';
import type { VaultState } from './state';
import {
	vaults,
	cachedRecords,
	opaqueOps,
	broadcast,
	storedAccountKeys,
	knowsKeyHistory,
	seedAccountKeys,
	constantTimeEqual,
	pendingFlows
} from './state';

export function newOpaqueOperationId(): string {
	return crypto.randomUUID();
}

export function reapOpaqueOps(): void {
	opaqueOps.reap();
}

setInterval(reapOpaqueOps, OPAQUE_OP_TTL_MS / 4);

export function toOpaqueWire(b64: string): string {
	return bytesToBase64Url(opaqueBase64ToBytes(b64));
}

export function fromOpaqueWire(opaqueB64Url: string): string {
	return opaqueBytesToBase64(base64UrlToBytes(opaqueB64Url));
}

export function handleOpaqueAbandonOperation(args: OpaqueAbandonOperationArgs): void {
	opaqueOps.abandon(args.operationId);
}

export async function handleOpaqueStartRegistration(
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

export async function handleOpaqueFinishRegistration(
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

	const { publicKey: pubObj, privateKey: privObj } = await generateCurve25519Key({
		userIDs: [{ email: op.email }],
		date: keyCreationDate(Date.now() + (args.serverClockOffsetMs ?? 0))
	});
	const publicKeyArmored = pubObj.armor();

	const amk = generateAMK();
	const exportKeyBytes = base64UrlToBytes(exportKey);
	const wrappedMasterKey = await wrapMasterKey(exportKeyBytes, amk, false);
	const masterKeyId = await deriveMasterKeyId(amk);
	const pgpPassphrase = await derivePgpPassphrase(amk);
	const encryptedPriv = await lockKey(privObj, pgpPassphrase);
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
		encryptedPrivateKey: armoredEncrypted
	};
}

export async function handleOpaqueFinalizeRegister(
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
			accountKeys: new Map(),
			keyVersion: 1,
			aliasKeys: new Map(),
			aliasCurrent: new Map()
		};
		await seedAccountKeys(v);
		vaults.set(args.accountId, v);

		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true, accountId: v.accountId, email: v.email };
	} catch (err) {
		wipeOpaqueOperation(op);
		console.warn('keystore: opaqueFinalizeRegister failed', err);
		return { ok: false, code: 'unwrap_failed' };
	}
}

export async function handleOpaqueStartAuth(args: OpaqueStartAuthArgs): Promise<OpaqueStartAuthResponse> {
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

export async function handleOpaqueFinishAuth(args: OpaqueFinishAuthArgs): Promise<OpaqueFinishAuthResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || !op.clientState || !op.password) {
		return { ok: false, code: 'no_pending_operation' };
	}
	const { clientState, password } = op;
	op.clientState = undefined;
	op.password = undefined;
	let settled = false;
	try {
		await opaqueReady;
		const recovery = args.recovery ?? op.recovery ?? false;
		const result = opaqueClient.finishLogin({
			clientLoginState: clientState,
			loginResponse: toOpaqueWire(args.ke2),
			password,
			identifiers: { client: clientIdentity(args.accountId, recovery), server: SERVER_IDENTITY },
			keyStretching: KEY_STRETCHING
		});
		if (!result) {
			return { ok: false, code: 'invalid_credentials' };
		}
		settleLogin(op, args.accountId, base64UrlToBytes(result.exportKey));
		settled = true;
		return { ok: true, ke3: fromOpaqueWire(result.finishLoginRequest) };
	} finally {
		if (!settled) opaqueOps.abandon(args.operationId);
	}
}

export async function handleOpaqueCompleteLoginUnlock(
	args: OpaqueCompleteLoginUnlockArgs
): Promise<OpaqueCompleteLoginUnlockResponse> {
	const op = opaqueOps.take(args.operationId);
	if (!op) {
		return { ok: false, code: 'no_pending_operation' };
	}
	if (!op.exportKey || op.accountId !== args.accountId) {
		wipeOpaqueOperation(op);
		return { ok: false, code: 'no_pending_operation' };
	}
	let amk: Uint8Array | undefined;
	let handedOver = false;
	try {
		amk = await unwrapMasterKey(op.exportKey, opaqueBase64ToBytes(args.wrappedMasterKey), false);
		wipeOpaqueOperation(op);
		const derivedMasterKeyId = opaqueBytesToBase64(await deriveMasterKeyId(amk));
		if (!constantTimeEqual(derivedMasterKeyId, args.masterKeyId)) {
			return { ok: false, code: 'master_key_mismatch' };
		}
		const pgpPassphrase = await derivePgpPassphrase(amk);
		const privateKey = await openpgp.readPrivateKey({ armoredKey: args.encryptedPrivateKey });
		const unlocked = await openpgp.decryptKey({ privateKey, passphrase: pgpPassphrase });

		const previous = cachedRecords.get(args.accountId) ?? (await getVault(args.accountId)) ?? undefined;
		const record: VaultRecord = {
			accountId: args.accountId,
			email: op.email ?? '',
			authScheme: args.serverAuthScheme,
			wrappedMasterKey: args.wrappedMasterKey,
			masterKeyId: args.masterKeyId,
			opaqueParamsVersion: args.opaqueParamsVersion,
			armoredEncryptedPrivateKey: args.encryptedPrivateKey,
			accountKeys: previous?.accountKeys,
			keyVersion: previous?.keyVersion,
			updatedAt: Date.now()
		};

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
			accountKeys: new Map(),
			keyVersion: 1,
			aliasKeys: new Map(),
			aliasCurrent: new Map()
		};
		await seedAccountKeys(v, record);
		const persisted: VaultRecord = {
			...record,
			armoredEncryptedPrivateKey: v.armoredEncryptedPrivateKey,
			...storedAccountKeys(v)
		};
		await putVault(persisted);
		cachedRecords.set(args.accountId, persisted);
		vaults.set(args.accountId, v);
		handedOver = true;

		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true, accountId: v.accountId, email: v.email };
	} catch (err) {
		console.warn('keystore: opaqueCompleteLoginUnlock failed', err);
		return { ok: false, code: 'unwrap_failed' };
	} finally {
		wipeOpaqueOperation(op);
		if (!handedOver) amk?.fill(0);
	}
}

export async function handleOpaqueRecoverySetupStart(
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

export async function handleOpaqueRecoverySetupFinish(
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

export async function handleOpaqueCompleteRecoveryUnlock(
	args: OpaqueCompleteRecoveryUnlockArgs
): Promise<OpaqueCompleteRecoveryUnlockResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || op.kind !== 'recoveryLogin' || !op.exportKey) {
		return { ok: false, code: 'no_pending_operation' };
	}
	try {
		const wrappedMasterKey = opaqueBase64ToBytes(args.wrappedMasterKey);
		const amk = await unwrapMasterKey(op.exportKey, wrappedMasterKey, true);
		op.exportKey.fill(0);
		op.exportKey = undefined;
		op.amk = amk;
		const pgpPassphrase = await derivePgpPassphrase(amk);
		const privateKey = await openpgp.readPrivateKey({ armoredKey: args.encryptedPrivateKey });
		const unlocked = await openpgp.decryptKey({ privateKey, passphrase: pgpPassphrase });

		op.privateKeyObj = unlocked;
		op.at = Date.now();
		return { ok: true };
	} catch (err) {
		wipeOpaqueOperation(op);
		opaqueOps.delete(args.operationId);
		console.warn('keystore: opaqueCompleteRecoveryUnlock failed', err);
		return { ok: false, code: 'invalid_credentials' };
	}
}

export async function handleOpaquePrepareCredentialReset(
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

export async function handleOpaqueFinishCredentialReset(
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

export async function handleOpaquePrepareAmkRotation(
	args: OpaquePrepareAmkRotationArgs
): Promise<OpaquePrepareAmkRotationResponse> {
	if (!pendingFlows.reset) {
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

export async function handleOpaqueFinishAmkRotation(
	args: OpaqueFinishAmkRotationArgs
): Promise<OpaqueFinishAmkRotationResponse> {
	const op = opaqueOps.get(args.operationId);
	if (!op || op.kind !== 'amkRotation' || !op.clientState || !op.password || !op.accountId) {
		return { ok: false, code: 'no_pending_operation' };
	}
	if (!pendingFlows.reset) {
		wipeOpaqueOperation(op);
		opaqueOps.delete(args.operationId);
		return { ok: false, code: 'no_pending_reset' };
	}
	if (knowsKeyHistory(op.accountId)) {
		wipeOpaqueOperation(op);
		opaqueOps.delete(args.operationId);
		return { ok: false, code: 'key_history_present' };
	}
	const p = pendingFlows.reset;

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
	const encrypted = await lockKey(p.privateKey, pgpPassphrase);
	exportKeyBytes.fill(0);
	amk.fill(0);
	pendingFlows.reset = null;
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

export async function handleOpaquePasswordChangeStart(
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

export async function handleOpaquePasswordChangeFinish(
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

export async function handleOpaquePasswordChangeCommit(
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
