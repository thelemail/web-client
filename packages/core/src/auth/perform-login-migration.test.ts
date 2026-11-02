import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError } from '$core/api/types';

const ACCOUNT = '5b0d1f8e-6a43-4c3e-9f1a-2c7d0e4b8a61';
const OPERATION = 'op-staged';
const FINGERPRINT = new Uint8Array([0xab, 0xcd, 0xef, 0x01]);

const keystore = vi.hoisted(() => ({
	opaqueStartAuth: vi.fn(),
	opaqueFinishAuth: vi.fn(),
	opaqueAbandonOperation: vi.fn(),
	opaqueCompleteLoginUnlock: vi.fn(),
	getPublicKey: vi.fn(),
	migrationFinalized: vi.fn(),
	enrollPersistent: vi.fn(),
	lock: vi.fn(),
	abandonLogin: vi.fn(),
	prepareLogin: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));

const api = vi.hoisted(() => ({
	loginInit: vi.fn(),
	loginComplete: vi.fn(),
	migrationFinalize: vi.fn(),
	getMigrationStatus: vi.fn(),
	getMe: vi.fn()
}));
vi.mock('$core/api/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/auth')>()),
	...api
}));

const twofactor = vi.hoisted(() => ({ verify2faTotp: vi.fn() }));
vi.mock('$core/api/twofactor', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/twofactor')>()),
	...twofactor
}));

const session = vi.hoisted(() => ({
	addSession: vi.fn(),
	forgetSession: vi.fn(),
	setSession: vi.fn(),
	loadProfile: vi.fn(),
	email: 'm@thelemail.com'
}));
vi.mock('$core/stores/auth.svelte', () => ({ auth: session }));

const accounts = vi.hoisted(() => ({
	load: vi.fn(),
	byId: vi.fn(),
	upsert: vi.fn(),
	allocateSlot: vi.fn()
}));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts }));
vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: async () => undefined }));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$app/navigation', () => ({ refreshAll: vi.fn(), goto: vi.fn() }));

const { performLogin, submitTwoFactorTotp } = await import('./perform-login');

const stagedGrant = {
	accountId: ACCOUNT,
	accessToken: 'token',
	tokenType: 'Bearer',
	expiresInSeconds: 3600,
	encryptedPrivateKey: 'staged-epk',
	wrappedMasterKey: 'staged-wmk',
	masterKeyId: 'staged-mk',
	opaqueParamsVersion: 1,
	staged: true,
	migrationFinalizeGrant: 'finalize-token',
	serverHalf: 'half'
};

const finalizedStatus = {
	authScheme: 'opaque_v1',
	masterKeyId: 'staged-mk',
	credentialGeneration: 3
};

const stillStagedStatus = {
	authScheme: 'srp_v1',
	migrationState: 'staged',
	masterKeyId: 'staged-mk',
	credentialGeneration: 2
};

function login() {
	return performLogin({ email: 'm@thelemail.com', password: 'pw', rememberMe: true });
}

function order(fn: { mock: { invocationCallOrder: number[] } }): number {
	const [first] = fn.mock.invocationCallOrder;
	if (first === undefined) throw new Error('not called');
	return first;
}

beforeEach(() => {
	for (const group of [keystore, api, twofactor, accounts]) {
		for (const fn of Object.values(group)) fn.mockReset();
	}
	for (const fn of [session.addSession, session.forgetSession, session.setSession, session.loadProfile]) {
		fn.mockReset();
	}
	keystore.opaqueStartAuth.mockResolvedValue({ operationId: OPERATION, ke1: 'ke1' });
	keystore.opaqueFinishAuth.mockResolvedValue({ ok: true, ke3: 'ke3' });
	keystore.opaqueAbandonOperation.mockResolvedValue(undefined);
	keystore.opaqueCompleteLoginUnlock.mockResolvedValue({ ok: true, accountId: ACCOUNT, email: 'm@thelemail.com' });
	keystore.getPublicKey.mockResolvedValue({ ok: true, publicKeyArmored: 'pub', fingerprint: FINGERPRINT, keyVersion: 1 });
	keystore.migrationFinalized.mockResolvedValue({ ok: true });
	keystore.enrollPersistent.mockResolvedValue({ ok: true });
	keystore.lock.mockResolvedValue(undefined);
	api.loginInit.mockResolvedValue({ challengeId: 'ch-1', accountId: ACCOUNT, ke2: 'ke2' });
	api.loginComplete.mockResolvedValue(stagedGrant);
	api.migrationFinalize.mockResolvedValue(undefined);
	api.getMigrationStatus.mockResolvedValue(finalizedStatus);
	api.getMe.mockResolvedValue({ accountId: ACCOUNT, keyFingerprint: 'ABCDEF01', keyVersion: 1 });
	accounts.load.mockResolvedValue(undefined);
	accounts.byId.mockReturnValue({ accountId: ACCOUNT, slot: 0, email: 'm@thelemail.com' });
	accounts.upsert.mockResolvedValue(undefined);
});

describe('staged credential migration', () => {
	it('unlocks and checks the key before it finalizes', async () => {
		const outcome = await login();

		expect(outcome.status).toBe('complete');
		expect(keystore.opaqueCompleteLoginUnlock).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: OPERATION, serverAuthScheme: 'srp_v1' })
		);
		expect(api.migrationFinalize).toHaveBeenCalledWith({ finalizeToken: 'finalize-token' });
		expect(order(keystore.opaqueCompleteLoginUnlock)).toBeLessThan(order(keystore.getPublicKey));
		expect(order(api.getMe)).toBeLessThan(order(api.migrationFinalize));
		expect(order(keystore.getPublicKey)).toBeLessThan(order(api.migrationFinalize));
		expect(order(api.migrationFinalize)).toBeLessThan(order(keystore.migrationFinalized));
		expect(order(keystore.migrationFinalized)).toBeLessThan(order(keystore.enrollPersistent));
		expect(keystore.migrationFinalized).toHaveBeenCalledWith({ accountId: ACCOUNT });
	});

	it.each(['unwrap_failed', 'master_key_mismatch'])(
		'never finalizes when the staged unlock fails with %s',
		async (code) => {
			keystore.opaqueCompleteLoginUnlock.mockResolvedValue({ ok: false, code });

			await expect(login()).rejects.toThrow();

			expect(api.migrationFinalize).not.toHaveBeenCalled();
			expect(keystore.migrationFinalized).not.toHaveBeenCalled();
			expect(session.forgetSession).toHaveBeenCalledWith(ACCOUNT);
			expect(session.setSession).not.toHaveBeenCalled();
		}
	);

	it('never finalizes when the unlocked key is not the published one', async () => {
		api.getMe.mockResolvedValue({ accountId: ACCOUNT, keyFingerprint: '00112233', keyVersion: 1 });

		await expect(login()).rejects.toThrow();

		expect(api.migrationFinalize).not.toHaveBeenCalled();
		expect(keystore.migrationFinalized).not.toHaveBeenCalled();
		expect(keystore.lock).toHaveBeenCalledWith({ accountId: ACCOUNT });
		expect(session.forgetSession).toHaveBeenCalledWith(ACCOUNT);
		expect(session.setSession).not.toHaveBeenCalled();
	});

	it('never finalizes when the published key cannot be read', async () => {
		api.getMe.mockRejectedValue(new ApiCallError(503, null, 'down'));

		await expect(login()).rejects.toThrow();

		expect(api.migrationFinalize).not.toHaveBeenCalled();
		expect(keystore.lock).toHaveBeenCalledWith({ accountId: ACCOUNT });
	});

	it('promotes the vault when the finalize response is lost but the server finalized', async () => {
		api.migrationFinalize.mockRejectedValue(new TypeError('Failed to fetch'));
		api.getMigrationStatus.mockResolvedValue(finalizedStatus);

		const outcome = await login();

		expect(outcome.status).toBe('complete');
		expect(api.getMigrationStatus).toHaveBeenCalledWith(ACCOUNT);
		expect(keystore.migrationFinalized).toHaveBeenCalledWith({ accountId: ACCOUNT });
		expect(order(keystore.migrationFinalized)).toBeLessThan(order(keystore.enrollPersistent));
	});

	it('keeps the password scheme when the finalize response is lost and the server did not finalize', async () => {
		api.migrationFinalize.mockRejectedValue(new TypeError('Failed to fetch'));
		api.getMigrationStatus.mockResolvedValue(stillStagedStatus);

		const outcome = await login();

		expect(outcome.status).toBe('complete');
		expect(keystore.migrationFinalized).not.toHaveBeenCalled();
		expect(keystore.enrollPersistent).toHaveBeenCalled();
	});

	it('keeps the password scheme when the server refuses the finalize', async () => {
		api.migrationFinalize.mockRejectedValue(new ApiCallError(409, null, 'migration_conflict'));
		api.getMigrationStatus.mockResolvedValue(stillStagedStatus);

		const outcome = await login();

		expect(outcome.status).toBe('complete');
		expect(api.migrationFinalize).toHaveBeenCalledTimes(1);
		expect(keystore.migrationFinalized).not.toHaveBeenCalled();
	});

	it('keeps the password scheme when the status is for a different master key', async () => {
		api.migrationFinalize.mockRejectedValue(new TypeError('Failed to fetch'));
		api.getMigrationStatus.mockResolvedValue({ ...finalizedStatus, masterKeyId: 'other-mk' });

		await login();

		expect(keystore.migrationFinalized).not.toHaveBeenCalled();
	});

	it('keeps the password scheme when the status cannot be read either', async () => {
		api.migrationFinalize.mockRejectedValue(new TypeError('Failed to fetch'));
		api.getMigrationStatus.mockRejectedValue(new TypeError('Failed to fetch'));

		const outcome = await login();

		expect(outcome.status).toBe('complete');
		expect(keystore.migrationFinalized).not.toHaveBeenCalled();
	});

	it('applies the same order after a two-factor step', async () => {
		api.loginComplete.mockResolvedValue({
			twoFactor: { pendingToken: 'pt-1', methods: ['totp'], expiresInSeconds: 300 }
		});
		const outcome = await login();
		if (outcome.status !== 'twoFactorRequired') throw new Error('expected a two-factor step');
		twofactor.verify2faTotp.mockResolvedValue(stagedGrant);
		keystore.opaqueCompleteLoginUnlock.mockResolvedValue({ ok: false, code: 'unwrap_failed' });

		await expect(submitTwoFactorTotp(outcome.pending, '123456')).rejects.toThrow();

		expect(api.migrationFinalize).not.toHaveBeenCalled();
		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
	});

	it('leaves an unstaged login alone', async () => {
		api.loginComplete.mockResolvedValue({
			...stagedGrant,
			staged: undefined,
			migrationFinalizeGrant: undefined
		});

		await login();

		expect(keystore.opaqueCompleteLoginUnlock).toHaveBeenCalledWith(
			expect.objectContaining({ serverAuthScheme: 'opaque_v1' })
		);
		expect(api.getMe).not.toHaveBeenCalled();
		expect(api.migrationFinalize).not.toHaveBeenCalled();
		expect(keystore.migrationFinalized).not.toHaveBeenCalled();
	});
});
