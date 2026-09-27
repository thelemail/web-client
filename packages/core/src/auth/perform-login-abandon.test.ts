import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError } from '$core/api/types';

const ACCOUNT = '120792e5-d313-4c0e-aa94-4a4b00cab094';
const OPERATION = 'op-1';

const keystore = vi.hoisted(() => ({
	opaqueStartAuth: vi.fn(),
	opaqueFinishAuth: vi.fn(),
	opaqueAbandonOperation: vi.fn(),
	opaqueCompleteLoginUnlock: vi.fn(),
	abandonLogin: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));

const api = vi.hoisted(() => ({ loginInit: vi.fn(), loginComplete: vi.fn() }));
vi.mock('$core/api/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/auth')>()),
	...api
}));

const twofactor = vi.hoisted(() => ({ verify2faTotp: vi.fn() }));
vi.mock('$core/api/twofactor', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/twofactor')>()),
	...twofactor
}));

const session = vi.hoisted(() => ({ addSession: vi.fn(), forgetSession: vi.fn() }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: session }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: {} }));
vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: async () => undefined }));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn() }));

const {
	abandonTwoFactorLogin,
	performLogin,
	submitTwoFactorTotp,
	TwoFactorRejectedError
} = await import('./perform-login');

const grant = {
	accountId: ACCOUNT,
	accessToken: 'token',
	tokenType: 'Bearer',
	expiresInSeconds: 3600,
	encryptedPrivateKey: 'epk',
	wrappedMasterKey: 'wmk',
	masterKeyId: 'mk-1',
	opaqueParamsVersion: 1
};

async function reachTwoFactor() {
	api.loginComplete.mockResolvedValue({
		twoFactor: { pendingToken: 'pt-1', methods: ['totp'], expiresInSeconds: 300 }
	});
	const outcome = await performLogin({ email: 'r@thelemail.com', password: 'pw' });
	if (outcome.status !== 'twoFactorRequired') throw new Error('expected a two-factor step');
	return outcome.pending;
}

beforeEach(() => {
	for (const fn of [
		...Object.values(keystore),
		...Object.values(api),
		...Object.values(twofactor),
		...Object.values(session)
	]) {
		fn.mockReset();
	}
	keystore.opaqueStartAuth.mockResolvedValue({ operationId: OPERATION, ke1: 'ke1' });
	keystore.opaqueFinishAuth.mockResolvedValue({ ok: true, ke3: 'ke3' });
	keystore.opaqueAbandonOperation.mockResolvedValue(undefined);
	api.loginInit.mockResolvedValue({ challengeId: 'ch-1', accountId: ACCOUNT, ke2: 'ke2' });
});

describe('pending OPAQUE login cleanup', () => {
	it('keeps the operation across the two-factor step', async () => {
		const pending = await reachTwoFactor();

		expect(pending.opaqueOperationId).toBe(OPERATION);
		expect(keystore.opaqueAbandonOperation).not.toHaveBeenCalled();
	});

	it('abandons the OPAQUE operation, not the SRP login, when two-factor is abandoned', async () => {
		const pending = await reachTwoFactor();

		await abandonTwoFactorLogin(pending);

		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
		expect(keystore.abandonLogin).not.toHaveBeenCalled();
	});

	it('keeps the operation when a code is rejected so the user can retry', async () => {
		const pending = await reachTwoFactor();
		twofactor.verify2faTotp.mockRejectedValue(new ApiCallError(401, null, 'bad code'));

		await expect(submitTwoFactorTotp(pending, '123456')).rejects.toBeInstanceOf(TwoFactorRejectedError);

		expect(keystore.opaqueAbandonOperation).not.toHaveBeenCalled();
	});

	it('hands the operation to the unlock once two-factor passes', async () => {
		const pending = await reachTwoFactor();
		twofactor.verify2faTotp.mockResolvedValue(grant);
		keystore.opaqueCompleteLoginUnlock.mockResolvedValue({ ok: false, code: 'unwrap_failed' });

		await expect(submitTwoFactorTotp(pending, '123456')).rejects.toThrow();

		expect(keystore.opaqueCompleteLoginUnlock).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: OPERATION, accountId: ACCOUNT })
		);
		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
	});

	it('abandons the operation when the post-two-factor grant is unusable', async () => {
		const pending = await reachTwoFactor();
		twofactor.verify2faTotp.mockResolvedValue({ ...grant, wrappedMasterKey: undefined });

		await expect(submitTwoFactorTotp(pending, '123456')).rejects.toThrow();

		expect(keystore.opaqueCompleteLoginUnlock).not.toHaveBeenCalled();
		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
	});

	it('abandons the operation when the login init fails', async () => {
		api.loginInit.mockRejectedValue(new ApiCallError(503, null, 'down'));

		await expect(performLogin({ email: 'r@thelemail.com', password: 'pw' })).rejects.toThrow();

		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
	});

	it('abandons the operation when the login completion fails', async () => {
		api.loginComplete.mockRejectedValue(new ApiCallError(401, null, 'no'));

		await expect(performLogin({ email: 'r@thelemail.com', password: 'pw' })).rejects.toThrow();

		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
	});

	it('abandons the operation when the keystore throws during finish', async () => {
		keystore.opaqueFinishAuth.mockRejectedValue(new Error('opaque protocol error'));

		await expect(performLogin({ email: 'r@thelemail.com', password: 'pw' })).rejects.toThrow();

		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
	});

	it('surfaces the original error when the abandon itself fails', async () => {
		api.loginInit.mockRejectedValue(new ApiCallError(503, null, 'down'));
		keystore.opaqueAbandonOperation.mockRejectedValue(new Error('worker gone'));

		await expect(performLogin({ email: 'r@thelemail.com', password: 'pw' })).rejects.toBeInstanceOf(
			ApiCallError
		);
	});
});
