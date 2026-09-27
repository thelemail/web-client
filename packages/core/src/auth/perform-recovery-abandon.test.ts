import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError } from '$core/api/types';

const ACCOUNT = '120792e5-d313-4c0e-aa94-4a4b00cab094';
const OPERATION = 'op-rec';

const keystore = vi.hoisted(() => ({
	opaqueStartAuth: vi.fn(),
	opaqueFinishAuth: vi.fn(),
	opaqueAbandonOperation: vi.fn(),
	opaqueCompleteRecoveryUnlock: vi.fn(),
	discardRecovery: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));

const api = vi.hoisted(() => ({ recoveryOpaqueInit: vi.fn(), recoveryOpaqueComplete: vi.fn() }));
vi.mock('$core/api/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/auth')>()),
	...api
}));

const twofactor = vi.hoisted(() => ({ verify2faTotp: vi.fn() }));
vi.mock('$core/api/twofactor', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/twofactor')>()),
	...twofactor
}));

vi.mock('$core/auth/perform-login', () => ({
	TwoFactorRejectedError: class extends Error {},
	TwoFactorExpiredError: class extends Error {}
}));

const { discardRecovery, submitRecoveryTwoFactorTotp, verifyRecoveryPhrase } = await import(
	'./perform-recovery'
);

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

beforeEach(() => {
	for (const fn of [...Object.values(keystore), ...Object.values(api), ...Object.values(twofactor)]) {
		fn.mockReset();
	}
	keystore.opaqueStartAuth.mockResolvedValue({ operationId: OPERATION, ke1: 'ke1' });
	keystore.opaqueFinishAuth.mockResolvedValue({ ok: true, ke3: 'ke3' });
	keystore.opaqueAbandonOperation.mockResolvedValue(undefined);
	keystore.discardRecovery.mockResolvedValue(undefined);
	api.recoveryOpaqueInit.mockResolvedValue({ challengeId: 'ch-1', accountId: ACCOUNT, ke2: 'ke2' });
});

describe('pending OPAQUE recovery cleanup', () => {
	it('discards the OPAQUE operation and any SRP recovery state', async () => {
		await discardRecovery(OPERATION);

		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
		expect(keystore.discardRecovery).toHaveBeenCalled();
	});

	it('abandons the operation when the recovery completion fails', async () => {
		api.recoveryOpaqueComplete.mockRejectedValue(new ApiCallError(503, null, 'down'));

		await expect(verifyRecoveryPhrase({ email: 'r@thelemail.com', phrase: PHRASE })).rejects.toThrow();

		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
	});

	it('abandons the operation when the post-two-factor grant is unusable', async () => {
		api.recoveryOpaqueComplete.mockResolvedValue({
			twoFactor: { pendingToken: 'pt-1', methods: ['totp'], expiresInSeconds: 300 }
		});
		const outcome = await verifyRecoveryPhrase({ email: 'r@thelemail.com', phrase: PHRASE });
		if (outcome.status !== 'twoFactorRequired') throw new Error('expected a two-factor step');
		expect(keystore.opaqueAbandonOperation).not.toHaveBeenCalled();
		twofactor.verify2faTotp.mockResolvedValue({ resetToken: 'rt-1', encryptedPrivateKey: 'epk' });

		await expect(submitRecoveryTwoFactorTotp(outcome.pending, '123456')).rejects.toThrow();

		expect(keystore.opaqueCompleteRecoveryUnlock).not.toHaveBeenCalled();
		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
	});
});
