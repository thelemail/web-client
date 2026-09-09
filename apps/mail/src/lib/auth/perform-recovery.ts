import {
	getModulus,
	loginInit,
	recoveryComplete,
	recoveryInit,
	recoveryOpaqueComplete,
	recoveryOpaqueInit,
	recoveryReset,
	recoveryResetAmkRotation,
	recoveryResetOpaque,
	recoveryResetOpaqueRegistrationInit
} from '$lib/api/auth';
import {
	init2faWebauthn,
	verify2faBackupCode,
	verify2faTotp,
	verify2faWebauthn
} from '$lib/api/twofactor';
import { ApiCallError, type RecoveryGrant, type TwoFactorMethod } from '$lib/api/types';
import {
	TwoFactorExpiredError,
	TwoFactorRejectedError
} from '$lib/auth/perform-login';
import { getAssertion } from '$lib/auth/webauthn';
import { keystore } from '$lib/keystore/keystore-client';

export class RecoveryPhraseError extends Error {
	constructor() {
		super('recovery phrase rejected');
		this.name = 'RecoveryPhraseError';
	}
}

export class RecoveryResetExpiredError extends Error {
	constructor() {
		super('recovery reset token expired or already used');
		this.name = 'RecoveryResetExpiredError';
	}
}

export interface VerifyRecoveryPhraseInput {
	email: string;
	phrase: string;
}

export interface VerifyRecoveryPhraseResult {
	accountId?: string;
	resetToken: string;
	resetTokenExpiresAt: number;
	opaqueOperationId?: string;
}

export interface PendingTwoFactorRecovery {
	pendingToken: string;
	methods: TwoFactorMethod[];
	expiresAt: number;
	opaqueOperationId?: string;
}

export type VerifyRecoveryPhraseOutcome =
	| { status: 'complete'; result: VerifyRecoveryPhraseResult }
	| { status: 'twoFactorRequired'; pending: PendingTwoFactorRecovery };

async function tryOpaqueRecovery(
	email: string,
	phrase: string
): Promise<VerifyRecoveryPhraseOutcome | null> {
	const start = await keystore.opaqueStartAuth({ password: phrase, email, recovery: true });
	const init = await recoveryOpaqueInit({ email, ke1: start.ke1 });
	if (!init.accountId || !init.ke2) {
		await keystore.opaqueAbandonOperation({ operationId: start.operationId });
		return null;
	}
	const finish = await keystore.opaqueFinishAuth({
		operationId: start.operationId,
		accountId: init.accountId,
		ke2: init.ke2,
		recovery: true
	});
	if (!finish.ok) {
		return null;
	}

	const complete = await recoveryOpaqueComplete({ challengeId: init.challengeId, ke3: finish.ke3 });

	if (complete.twoFactor) {
		return {
			status: 'twoFactorRequired',
			pending: {
				pendingToken: complete.twoFactor.pendingToken,
				methods: complete.twoFactor.methods,
				expiresAt: Date.now() + complete.twoFactor.expiresInSeconds * 1000,
				opaqueOperationId: start.operationId
			}
		};
	}

	const result = await finishOpaqueRecoveryUnlock(complete, start.operationId);
	return { status: 'complete', result };
}

export async function verifyRecoveryPhrase(
	input: VerifyRecoveryPhraseInput
): Promise<VerifyRecoveryPhraseOutcome> {
	const { email, phrase } = input;

	const opaqueOutcome = await tryOpaqueRecovery(email, phrase);
	if (opaqueOutcome) {
		return opaqueOutcome;
	}

	const init = await recoveryInit({ email });
	const proofs = await keystore.prepareRecoveryLogin({
		email,
		phrase,
		modulus: init.modulus,
		salt: init.salt,
		serverPublicEphemeral: init.serverPublicEphemeral
	});

	let complete;
	try {
		complete = await recoveryComplete({
			challengeId: init.challengeId,
			clientPublicEphemeral: proofs.clientPublicEphemeral,
			clientProof: proofs.clientProof
		});
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 401) {
			throw new RecoveryPhraseError();
		}
		throw err;
	}

	const verified = await keystore.verifyRecoveryProof({ serverProof: complete.serverProof as string });
	if (!verified.ok) {
		throw new RecoveryPhraseError();
	}

	if (complete.twoFactor) {
		return {
			status: 'twoFactorRequired',
			pending: {
				pendingToken: complete.twoFactor.pendingToken,
				methods: complete.twoFactor.methods,
				expiresAt: Date.now() + complete.twoFactor.expiresInSeconds * 1000
			}
		};
	}

	const result = await finishRecoveryUnlock(complete as RecoveryGrant);
	return { status: 'complete', result };
}

async function finishRecoveryUnlock(grant: RecoveryGrant): Promise<VerifyRecoveryPhraseResult> {
	const unlock = await keystore.completeRecoveryUnlock({
		encryptedPrivateKey: grant.encryptedPrivateKey,
		keySalt: grant.keySalt as string,
		resetTokenExpiresInSeconds: grant.resetTokenExpiresInSeconds
	});
	if (!unlock.ok) {
		throw new RecoveryPhraseError();
	}
	return {
		accountId: grant.accountId,
		resetToken: grant.resetToken,
		resetTokenExpiresAt: Date.now() + grant.resetTokenExpiresInSeconds * 1000
	};
}

async function finishOpaqueRecoveryUnlock(
	grant: Partial<RecoveryGrant>,
	operationId: string
): Promise<VerifyRecoveryPhraseResult> {
	if (!grant.encryptedPrivateKey || !grant.wrappedMasterKey || !grant.resetToken || !grant.resetTokenExpiresInSeconds) {
		throw new RecoveryPhraseError();
	}
	const unlock = await keystore.opaqueCompleteRecoveryUnlock({
		operationId,
		encryptedPrivateKey: grant.encryptedPrivateKey,
		wrappedMasterKey: grant.wrappedMasterKey,
		resetTokenExpiresInSeconds: grant.resetTokenExpiresInSeconds
	});
	if (!unlock.ok) {
		throw new RecoveryPhraseError();
	}
	return {
		resetToken: grant.resetToken,
		resetTokenExpiresAt: Date.now() + grant.resetTokenExpiresInSeconds * 1000,
		opaqueOperationId: operationId
	};
}

function classifyRecoveryTwoFactorError(err: unknown): never {
	if (err instanceof ApiCallError) {
		if (err.status === 401) {
			throw new TwoFactorRejectedError();
		}
		if (err.status === 404 || err.status === 410) {
			throw new TwoFactorExpiredError();
		}
	}
	throw err;
}

function assertRecoveryGrant(res: unknown): Partial<RecoveryGrant> {
	const grant = res as Partial<RecoveryGrant>;
	if (!grant.resetToken || !grant.encryptedPrivateKey) {
		throw new RecoveryPhraseError();
	}
	return grant;
}

async function finishPendingRecovery(
	grant: Partial<RecoveryGrant>,
	pending: PendingTwoFactorRecovery
): Promise<VerifyRecoveryPhraseResult> {
	if (pending.opaqueOperationId) {
		return finishOpaqueRecoveryUnlock(grant, pending.opaqueOperationId);
	}
	return finishRecoveryUnlock(grant as RecoveryGrant);
}

export async function submitRecoveryTwoFactorTotp(
	pending: PendingTwoFactorRecovery,
	code: string
): Promise<VerifyRecoveryPhraseResult> {
	let res;
	try {
		res = await verify2faTotp({ pendingToken: pending.pendingToken, code });
	} catch (err) {
		classifyRecoveryTwoFactorError(err);
	}
	return finishPendingRecovery(assertRecoveryGrant(res), pending);
}

export async function submitRecoveryTwoFactorBackupCode(
	pending: PendingTwoFactorRecovery,
	code: string
): Promise<VerifyRecoveryPhraseResult> {
	let res;
	try {
		res = await verify2faBackupCode({ pendingToken: pending.pendingToken, code });
	} catch (err) {
		classifyRecoveryTwoFactorError(err);
	}
	return finishPendingRecovery(assertRecoveryGrant(res), pending);
}

export async function submitRecoveryTwoFactorWebauthn(
	pending: PendingTwoFactorRecovery
): Promise<VerifyRecoveryPhraseResult> {
	let options;
	try {
		options = await init2faWebauthn({ pendingToken: pending.pendingToken });
	} catch (err) {
		classifyRecoveryTwoFactorError(err);
	}
	const credential = await getAssertion(options);
	let res;
	try {
		res = await verify2faWebauthn({ pendingToken: pending.pendingToken, credential });
	} catch (err) {
		classifyRecoveryTwoFactorError(err);
	}
	return finishPendingRecovery(assertRecoveryGrant(res), pending);
}

export type RecoveryResetStage = 'derive' | 'rewrap' | 'submit';

export interface CompleteRecoveryResetInput {
	accountId?: string;
	resetToken: string;
	newPassword: string;
	opaqueOperationId?: string;
	onStage?: (stage: RecoveryResetStage) => void;
}

async function completeOpaqueRecoveryReset(
	operationId: string,
	resetToken: string,
	newPassword: string
): Promise<void> {
	const prep = await keystore.opaquePrepareCredentialReset({ operationId, newPassword });
	if (!prep.ok) {
		throw new RecoveryResetExpiredError();
	}
	const init = await recoveryResetOpaqueRegistrationInit({
		resetToken,
		registrationRequest: prep.registrationRequest
	});
	const finish = await keystore.opaqueFinishCredentialReset({
		operationId,
		registrationResponse: init.registrationResponse
	});
	if (!finish.ok) {
		throw new RecoveryResetExpiredError();
	}
	try {
		await recoveryResetOpaque({
			resetToken,
			opaqueRecord: finish.opaqueRecord,
			wrappedMasterKey: finish.wrappedMasterKey,
			masterKeyId: finish.masterKeyId,
			opaqueParamsVersion: finish.opaqueParamsVersion
		});
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 401) {
			throw new RecoveryResetExpiredError();
		}
		throw err;
	} finally {
		await keystore.discardRecovery();
	}
}

export async function completeRecoveryReset(input: CompleteRecoveryResetInput): Promise<void> {
	const { accountId, resetToken, newPassword, opaqueOperationId, onStage } = input;

	if (opaqueOperationId) {
		onStage?.('derive');
		onStage?.('rewrap');
		onStage?.('submit');
		return completeOpaqueRecoveryReset(opaqueOperationId, resetToken, newPassword);
	}

	onStage?.('derive');
	const modulus = (await getModulus()).modulus;
	const prep = await keystore.prepareCredentialReset({ newPassword, modulus });
	if (!prep.ok) {
		throw new RecoveryResetExpiredError();
	}
	onStage?.('rewrap');
	onStage?.('submit');
	try {
		await recoveryReset({
			resetToken,
			srpSalt: prep.srpSalt,
			srpVerifier: prep.srpVerifier,
			keySalt: prep.keySalt,
			encryptedPrivateKey: prep.encryptedPrivateKey,
			kdfParamsVersion: 1,
			srpParamsVersion: 1
		});
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 409 && accountId) {
			return completeAmkRotation({ accountId, newPassword, resetToken });
		}
		if (err instanceof ApiCallError && err.status === 401) {
			await keystore.discardRecovery();
			throw new RecoveryResetExpiredError();
		}
		await keystore.discardRecovery();
		throw err;
	}
	await keystore.discardRecovery();
}

export interface CompleteAmkRotationInput {
	accountId: string;
	newPassword: string;
	resetToken: string;
}

export async function completeAmkRotation(input: CompleteAmkRotationInput): Promise<void> {
	const { accountId, newPassword, resetToken } = input;

	const prep = await keystore.opaquePrepareAmkRotation({ accountId, newPassword });
	if (!prep.ok) {
		throw new RecoveryResetExpiredError();
	}
	const init = await recoveryResetOpaqueRegistrationInit({
		resetToken,
		registrationRequest: prep.registrationRequest
	});
	const rotation = await keystore.opaqueFinishAmkRotation({
		operationId: prep.operationId,
		registrationResponse: init.registrationResponse
	});
	if (!rotation.ok) {
		throw new RecoveryResetExpiredError();
	}

	try {
		await recoveryResetAmkRotation({
			resetToken,
			opaqueRecord: rotation.opaqueRecord,
			wrappedMasterKey: rotation.wrappedMasterKey,
			masterKeyId: rotation.masterKeyId,
			opaqueParamsVersion: rotation.opaqueParamsVersion,
			encryptedPrivateKey: rotation.encryptedPrivateKey
		});
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 401) {
			throw new RecoveryResetExpiredError();
		}
		throw err;
	} finally {
		await keystore.discardRecovery();
	}
}
