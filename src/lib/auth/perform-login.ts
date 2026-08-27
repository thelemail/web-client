import {
	loginInit,
	loginComplete,
	migrationFinalize,
	migrationRegistrationInit,
	migrationStage
} from '$lib/api/auth';
import {
	init2faWebauthn,
	verify2faBackupCode,
	verify2faTotp,
	verify2faWebauthn
} from '$lib/api/twofactor';
import { ApiCallError, type LoginSessionGrant, type TwoFactorMethod } from '$lib/api/types';
import { getAssertion } from '$lib/auth/webauthn';
import { keystore } from '$lib/keystore/keystore-client';
import { auth } from '$lib/stores/auth.svelte';
import { accounts } from '$lib/stores/accounts.svelte';
import { syncAddressUids } from '$lib/keys/uid-sync';

export interface PerformLoginInput {
	email: string;
	password: string;
	rememberMe?: boolean;
}

export interface PerformLoginResult {
	accountId: string;
	slot: number;
}

export interface PendingTwoFactorLogin {
	pendingToken: string;
	methods: TwoFactorMethod[];
	email: string;
	rememberMe: boolean;
	expiresAt: number;
	srpSalt?: string;
	opaqueOperationId?: string;
	password?: string;
}

export type PerformLoginOutcome =
	| { status: 'complete'; result: PerformLoginResult }
	| { status: 'twoFactorRequired'; pending: PendingTwoFactorLogin };

export class TwoFactorRejectedError extends Error {
	constructor() {
		super('two-factor code rejected');
		this.name = 'TwoFactorRejectedError';
	}
}

export class TwoFactorExpiredError extends Error {
	constructor() {
		super('two-factor challenge expired');
		this.name = 'TwoFactorExpiredError';
	}
}

const FINALIZE_ATTEMPTS = 3;
const FINALIZE_RETRY_MS = 400;

async function finalizeMigrationIfGranted(grant: Partial<LoginSessionGrant>): Promise<boolean> {
	if (!grant.migrationFinalizeGrant) return false;
	for (let attempt = 1; attempt <= FINALIZE_ATTEMPTS; attempt++) {
		try {
			await migrationFinalize({ finalizeToken: grant.migrationFinalizeGrant });
			return true;
		} catch (err) {
			if (err instanceof ApiCallError && err.status >= 400 && err.status < 500) {
				console.warn('login: migration finalize rejected', err.status);
				return false;
			}
			if (attempt === FINALIZE_ATTEMPTS) {
				console.warn('login: migration finalize failed', err);
				return false;
			}
			await new Promise((resolve) => setTimeout(resolve, FINALIZE_RETRY_MS * attempt));
		}
	}
	return false;
}

async function stageMigrationIfGranted(
	grant: Partial<LoginSessionGrant>,
	accountId: string,
	password: string
): Promise<void> {
	if (!grant.migrationStageGrant) return;
	try {
		const start = await keystore.migrationStartRegistration({ accountId, password });
		if (!start.ok) return;
		const init = await migrationRegistrationInit({
			grantToken: grant.migrationStageGrant,
			registrationRequest: start.registrationRequest
		});
		const finish = await keystore.migrationFinishStage({
			accountId,
			operationId: start.operationId,
			registrationResponse: init.registrationResponse
		});
		if (!finish.ok) return;
		await migrationStage({
			grantToken: grant.migrationStageGrant,
			opaqueRecord: finish.opaqueRecord,
			wrappedMasterKey: finish.wrappedMasterKey,
			masterKeyId: finish.masterKeyId,
			opaqueParamsVersion: finish.opaqueParamsVersion,
			stagedEncryptedPrivateKey: finish.stagedEncryptedPrivateKey
		});
	} catch (err) {
		console.warn('login: migration stage failed (non-fatal)', err);
	}
}

async function tryOpaqueLogin(
	email: string,
	password: string,
	rememberMe: boolean
): Promise<PerformLoginOutcome | null> {
	const start = await keystore.opaqueStartAuth({ password, email });
	const init = await loginInit({ email, ke1: start.ke1 });
	if (!init.accountId || !init.ke2) {
		await keystore.opaqueAbandonOperation({ operationId: start.operationId });
		return null;
	}
	const finish = await keystore.opaqueFinishAuth({
		operationId: start.operationId,
		accountId: init.accountId,
		ke2: init.ke2
	});
	if (!finish.ok) {
		return null;
	}

	let complete;
	try {
		complete = await loginComplete({
			challengeId: init.challengeId,
			ke3: finish.ke3,
			enrollPersistentSession: rememberMe
		});
	} catch (err) {
		await keystore.opaqueAbandonOperation({ operationId: start.operationId });
		throw err;
	}

	if (complete.twoFactor) {
		return {
			status: 'twoFactorRequired',
			pending: {
				pendingToken: complete.twoFactor.pendingToken,
				methods: complete.twoFactor.methods,
				email,
				rememberMe,
				expiresAt: Date.now() + complete.twoFactor.expiresInSeconds * 1000,
				opaqueOperationId: start.operationId
			}
		};
	}

	const result = await finishOpaqueLogin(complete, start.operationId, email, rememberMe);
	return { status: 'complete', result };
}

export async function performLogin(input: PerformLoginInput): Promise<PerformLoginOutcome> {
	const { email, rememberMe = false } = input;
	let password = input.password;

	const opaqueOutcome = await tryOpaqueLogin(email, password, rememberMe);
	if (opaqueOutcome) {
		password = '';
		return opaqueOutcome;
	}

	const init = await loginInit({ email });
	const proofs = await keystore.prepareLogin({
		email,
		password,
		modulus: init.modulus as string,
		salt: init.salt as string,
		serverPublicEphemeral: init.serverPublicEphemeral as string
	});

	const complete = await loginComplete({
		challengeId: init.challengeId,
		clientPublicEphemeral: proofs.clientPublicEphemeral,
		clientProof: proofs.clientProof,
		enrollPersistentSession: rememberMe
	});

	const verified = await keystore.verifyLoginProof({ serverProof: complete.serverProof as string });
	if (!verified.ok) {
		password = '';
		console.error('login: server proof verification failed', verified.code);
		throw new Error(
			verified.code === 'no_pending_login'
				? 'Sign-in was interrupted — please try again.'
				: 'Could not verify the server. Please try again.'
		);
	}

	if (complete.twoFactor) {
		const pendingPassword = password;
		password = '';
		return {
			status: 'twoFactorRequired',
			pending: {
				pendingToken: complete.twoFactor.pendingToken,
				methods: complete.twoFactor.methods,
				email,
				rememberMe,
				expiresAt: Date.now() + complete.twoFactor.expiresInSeconds * 1000,
				srpSalt: init.salt,
				password: pendingPassword
			}
		};
	}

	const result = await finishLogin(complete, email, init.salt as string, rememberMe, password);
	password = '';
	return { status: 'complete', result };
}

async function finishOpaqueLogin(
	grant: Partial<LoginSessionGrant>,
	operationId: string,
	email: string,
	rememberMe: boolean
): Promise<PerformLoginResult> {
	if (!grant.accountId || !grant.encryptedPrivateKey || !grant.wrappedMasterKey || !grant.masterKeyId) {
		throw new Error('Sign-in failed — unexpected server response.');
	}
	const finalized = await finalizeMigrationIfGranted(grant);
	const unlock = await keystore.opaqueCompleteLoginUnlock({
		operationId,
		accountId: grant.accountId,
		encryptedPrivateKey: grant.encryptedPrivateKey,
		wrappedMasterKey: grant.wrappedMasterKey,
		masterKeyId: grant.masterKeyId,
		opaqueParamsVersion: grant.opaqueParamsVersion ?? 1,
		serverAuthScheme: finalized || !grant.staged ? 'opaque_v1' : 'srp_v1'
	});
	if (!unlock.ok) {
		console.error('login: opaqueCompleteLoginUnlock failed', unlock.code);
		throw new Error(
			unlock.code === 'no_pending_operation'
				? 'Sign-in was interrupted — please try again.'
				: 'Could not unlock your mailbox keys. Please try again.'
		);
	}

	if (rememberMe && grant.serverHalf) {
		try {
			await keystore.enrollPersistent({ accountId: grant.accountId, serverHalf: grant.serverHalf });
		} catch (err) {
			console.warn('login: remember-me enrollment failed (non-fatal)', err);
		}
	}

	return finishLoginSession(grant.accountId, grant.accessToken as string, grant.expiresInSeconds as number, email);
}

async function finishLogin(
	grant: Partial<LoginSessionGrant>,
	email: string,
	srpSalt: string,
	rememberMe: boolean,
	password: string
): Promise<PerformLoginResult> {
	if (!grant.accountId || !grant.encryptedPrivateKey || !grant.keySalt) {
		throw new Error('Sign-in failed — unexpected server response.');
	}
	const unlock = await keystore.completeLoginUnlock({
		accountId: grant.accountId,
		encryptedPrivateKey: grant.encryptedPrivateKey,
		keySalt: grant.keySalt,
		srpSalt
	});
	if (!unlock.ok) {
		console.error('login: completeLoginUnlock failed', unlock.code);
		throw new Error(
			unlock.code === 'invalid_credentials'
				? 'Could not unlock your mailbox keys. Please try again.'
				: 'Sign-in was interrupted — please try again.'
		);
	}

	if (rememberMe && grant.serverHalf) {
		try {
			await keystore.enrollPersistent({ accountId: grant.accountId, serverHalf: grant.serverHalf });
		} catch (err) {
			console.warn('login: remember-me enrollment failed (non-fatal)', err);
		}
	}

	void stageMigrationIfGranted(grant, grant.accountId, password);
	return finishLoginSession(grant.accountId, grant.accessToken as string, grant.expiresInSeconds as number, email);
}

async function finishLoginSession(
	accountId: string,
	accessToken: string,
	expiresInSeconds: number,
	email: string
): Promise<PerformLoginResult> {
	auth.setSession(accessToken, expiresInSeconds, accountId);
	await auth.loadProfile();
	await accounts.load();
	const existing = accounts.byId(accountId);
	const now = Date.now();
	let slot: number;
	if (existing) {
		slot = existing.slot;
		await accounts.upsert({ ...existing, email, lastActiveAt: now });
	} else {
		slot = accounts.allocateSlot();
		await accounts.upsert({ accountId, slot, email, addedAt: now, lastActiveAt: now });
	}
	void syncAddressUids(accountId);
	return { accountId, slot };
}

function classifyTwoFactorError(err: unknown): never {
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

function assertSessionGrant(res: unknown): Partial<LoginSessionGrant> {
	const grant = res as Partial<LoginSessionGrant>;
	if (!grant.accessToken || !grant.accountId || !grant.encryptedPrivateKey) {
		throw new Error('Sign-in failed — unexpected server response.');
	}
	return grant;
}

async function finishPendingLogin(
	grant: Partial<LoginSessionGrant>,
	pending: PendingTwoFactorLogin
): Promise<PerformLoginResult> {
	if (pending.opaqueOperationId) {
		return finishOpaqueLogin(grant, pending.opaqueOperationId, pending.email, pending.rememberMe);
	}
	return finishLogin(grant, pending.email, pending.srpSalt as string, pending.rememberMe, pending.password ?? '');
}

export async function submitTwoFactorTotp(
	pending: PendingTwoFactorLogin,
	code: string
): Promise<PerformLoginResult> {
	let res;
	try {
		res = await verify2faTotp({
			pendingToken: pending.pendingToken,
			code,
			enrollPersistentSession: pending.rememberMe
		});
	} catch (err) {
		classifyTwoFactorError(err);
	}
	return finishPendingLogin(assertSessionGrant(res), pending);
}

export async function submitTwoFactorBackupCode(
	pending: PendingTwoFactorLogin,
	code: string
): Promise<PerformLoginResult> {
	let res;
	try {
		res = await verify2faBackupCode({
			pendingToken: pending.pendingToken,
			code,
			enrollPersistentSession: pending.rememberMe
		});
	} catch (err) {
		classifyTwoFactorError(err);
	}
	return finishPendingLogin(assertSessionGrant(res), pending);
}

export async function submitTwoFactorWebauthn(
	pending: PendingTwoFactorLogin
): Promise<PerformLoginResult> {
	let options;
	try {
		options = await init2faWebauthn({ pendingToken: pending.pendingToken });
	} catch (err) {
		classifyTwoFactorError(err);
	}
	const credential = await getAssertion(options);
	let res;
	try {
		res = await verify2faWebauthn({
			pendingToken: pending.pendingToken,
			credential,
			enrollPersistentSession: pending.rememberMe
		});
	} catch (err) {
		classifyTwoFactorError(err);
	}
	return finishPendingLogin(assertSessionGrant(res), pending);
}

export async function abandonTwoFactorLogin(pending?: PendingTwoFactorLogin): Promise<void> {
	try {
		if (pending?.opaqueOperationId) {
			await keystore.opaqueAbandonOperation({ operationId: pending.opaqueOperationId });
		} else {
			await keystore.abandonLogin();
		}
	} catch (err) {
		console.warn('login: abandon failed (non-fatal)', err);
	}
}
