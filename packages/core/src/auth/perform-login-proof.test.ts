import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError, type ErrorCode, type ProofChallenge } from '$core/api/types';

const ACCOUNT = '120792e5-d313-4c0e-aa94-4a4b00cab094';
const OPERATION = 'op-1';

const keystore = vi.hoisted(() => ({
	opaqueStartAuth: vi.fn(),
	opaqueFinishAuth: vi.fn(),
	opaqueAbandonOperation: vi.fn(),
	prepareLogin: vi.fn(),
	verifyLoginProof: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));

const api = vi.hoisted(() => ({ loginInit: vi.fn(), loginComplete: vi.fn() }));
vi.mock('$core/api/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/auth')>()),
	...api
}));

const pow = vi.hoisted(() => ({ solveProof: vi.fn() }));
vi.mock('$core/auth/proof-of-work', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/auth/proof-of-work')>()),
	...pow
}));

vi.mock('$core/stores/auth.svelte', () => ({ auth: {} }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: {} }));
vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: async () => undefined }));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn() }));

const { performLogin } = await import('./perform-login');

const challenge: ProofChallenge = {
	parameters: {
		algorithm: 'PBKDF2/SHA-256',
		nonce: 'n',
		salt: 's',
		cost: 1000,
		keyLength: 32,
		keyPrefix: '00',
		expiresAt: 1_900_000_600
	},
	signature: 'sig'
};

const twoFactor = { twoFactor: { pendingToken: 'pt-1', methods: ['totp'], expiresInSeconds: 300 } };
const opaqueInit = { challengeId: 'ch-1', accountId: ACCOUNT, ke2: 'ke2' };
const srpInit = { challengeId: 'ch-srp', salt: 'salt', modulus: 'mod', serverPublicEphemeral: 'B' };

function rejection(code: ErrorCode, status = 422) {
	return new ApiCallError(status, { error: { code, message: code } }, code);
}

function login(extra: { onVerifying?: (active: boolean) => void } = {}) {
	return performLogin({ email: 'r@thelemail.com', password: 'pw', ...extra });
}

beforeEach(() => {
	for (const fn of [...Object.values(keystore), ...Object.values(api), ...Object.values(pow)]) {
		fn.mockReset();
	}
	keystore.opaqueStartAuth.mockResolvedValue({ operationId: OPERATION, ke1: 'ke1' });
	keystore.opaqueFinishAuth.mockResolvedValue({ ok: true, ke3: 'ke3' });
	keystore.opaqueAbandonOperation.mockResolvedValue(undefined);
	keystore.prepareLogin.mockResolvedValue({ clientPublicEphemeral: 'A', clientProof: 'M1' });
	keystore.verifyLoginProof.mockResolvedValue({ ok: true });
	api.loginComplete.mockResolvedValue(twoFactor);
	pow.solveProof.mockResolvedValue('solved');
});

describe('sign-in proof of work', () => {
	it('sends no proof when the server asks for none', async () => {
		api.loginInit.mockResolvedValue(opaqueInit);

		await login();

		expect(pow.solveProof).not.toHaveBeenCalled();
		expect(api.loginComplete.mock.calls[0][0].proof).toBeUndefined();
	});

	it('solves the challenge from login init and sends the proof with the KE3', async () => {
		api.loginInit.mockResolvedValue({ ...opaqueInit, proofChallenge: challenge });
		const onVerifying = vi.fn();

		await login({ onVerifying });

		expect(pow.solveProof).toHaveBeenCalledWith(challenge, expect.any(AbortSignal));
		expect(api.loginComplete).toHaveBeenCalledWith(expect.objectContaining({ ke3: 'ke3', proof: 'solved' }));
		expect(onVerifying.mock.calls).toEqual([[true], [false]]);
	});

	it('solves the SRP fallback challenge, not the one from the OPAQUE init', async () => {
		api.loginInit
			.mockResolvedValueOnce({ challengeId: 'ch-1', proofChallenge: challenge })
			.mockResolvedValueOnce({ ...srpInit, proofChallenge: challenge });

		await login();

		expect(pow.solveProof).toHaveBeenCalledTimes(1);
		expect(api.loginComplete).toHaveBeenCalledWith(
			expect.objectContaining({ challengeId: 'ch-srp', clientProof: 'M1', proof: 'solved' })
		);
	});

	it.each(['proof_required', 'proof_expired'] as const)(
		'starts again from login init once after %s',
		async (code) => {
			api.loginInit
				.mockResolvedValueOnce(opaqueInit)
				.mockResolvedValueOnce({ ...opaqueInit, challengeId: 'ch-2', proofChallenge: challenge });
			api.loginComplete.mockRejectedValueOnce(rejection(code)).mockResolvedValueOnce(twoFactor);

			const outcome = await login();

			expect(outcome.status).toBe('twoFactorRequired');
			expect(api.loginInit).toHaveBeenCalledTimes(2);
			expect(api.loginComplete).toHaveBeenLastCalledWith(
				expect.objectContaining({ challengeId: 'ch-2', proof: 'solved' })
			);
			expect(keystore.opaqueStartAuth).toHaveBeenCalledTimes(2);
		}
	);

	it('gives up after the second proof_required', async () => {
		api.loginInit.mockResolvedValue({ ...opaqueInit, proofChallenge: challenge });
		api.loginComplete.mockRejectedValue(rejection('proof_required'));

		await expect(login()).rejects.toBeInstanceOf(ApiCallError);

		expect(api.loginInit).toHaveBeenCalledTimes(2);
	});

	it.each(['proof_invalid', 'proof_reused'] as const)('does not start again after %s', async (code) => {
		api.loginInit.mockResolvedValue({ ...opaqueInit, proofChallenge: challenge });
		api.loginComplete.mockRejectedValue(rejection(code));

		await expect(login()).rejects.toBeInstanceOf(ApiCallError);

		expect(api.loginInit).toHaveBeenCalledTimes(1);
	});

	it('does not start again after a rate limit', async () => {
		api.loginInit.mockResolvedValue(opaqueInit);
		api.loginComplete.mockRejectedValue(rejection('rate_limited', 429));

		await expect(login()).rejects.toBeInstanceOf(ApiCallError);

		expect(api.loginInit).toHaveBeenCalledTimes(1);
	});

	it('abandons the OPAQUE operation when the solve fails', async () => {
		api.loginInit.mockResolvedValue({ ...opaqueInit, proofChallenge: challenge });
		pow.solveProof.mockRejectedValue(new Error('solver crashed'));
		const onVerifying = vi.fn();

		await expect(login({ onVerifying })).rejects.toThrow('solver crashed');

		expect(keystore.opaqueFinishAuth).not.toHaveBeenCalled();
		expect(api.loginComplete).not.toHaveBeenCalled();
		expect(keystore.opaqueAbandonOperation).toHaveBeenCalledWith({ operationId: OPERATION });
		expect(onVerifying).toHaveBeenLastCalledWith(false);
	});
});
