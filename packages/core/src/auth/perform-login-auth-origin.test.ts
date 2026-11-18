import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError } from '$core/api/types';

const ACCOUNT = '5b0d1f8e-6a43-4c3e-9f1a-2c7d0e4b8a61';
const FINGERPRINT = new Uint8Array([0xab, 0xcd, 0xef, 0x01]);

vi.mock('$core/products', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/products')>()),
	isAuthOrigin: true
}));

const keystore = vi.hoisted(() => ({
	opaqueStartAuth: vi.fn(),
	opaqueFinishAuth: vi.fn(),
	opaqueAbandonOperation: vi.fn(),
	opaqueCompleteLoginUnlock: vi.fn(),
	prepareLogin: vi.fn(),
	verifyLoginProof: vi.fn(),
	completeLoginUnlock: vi.fn(),
	abandonLogin: vi.fn(),
	migrationStartRegistration: vi.fn(),
	migrationFinishStage: vi.fn(),
	migrationFinalized: vi.fn(),
	getPublicKey: vi.fn(),
	enrollPersistent: vi.fn(),
	lock: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));

const api = vi.hoisted(() => ({
	loginInit: vi.fn(),
	loginComplete: vi.fn(),
	migrationRegistrationInit: vi.fn(),
	migrationStage: vi.fn(),
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
	vaultOpened: vi.fn(),
	loadProfile: vi.fn(),
	email: 'm@thelemail.com'
}));
vi.mock('$core/stores/session.svelte', () => ({ auth: session }));

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

const srpInit = { challengeId: 'ch-srp', salt: 'srp-salt', modulus: 'mod', serverPublicEphemeral: 'B' };
const opaqueInit = { challengeId: 'ch-opaque', accountId: ACCOUNT, ke2: 'ke2' };

const srpGrant = {
	accountId: ACCOUNT,
	accessToken: 'srp-token',
	tokenType: 'Bearer',
	expiresInSeconds: 3600,
	serverProof: 'M2',
	encryptedPrivateKey: 'srp-epk',
	keySalt: 'key-salt',
	migrationStageGrant: 'stage-token'
};

const stagedGrant = {
	accountId: ACCOUNT,
	accessToken: 'opaque-token',
	tokenType: 'Bearer',
	expiresInSeconds: 3600,
	encryptedPrivateKey: 'staged-epk',
	wrappedMasterKey: 'staged-wmk',
	masterKeyId: 'staged-mk',
	opaqueParamsVersion: 1,
	staged: true,
	migrationFinalizeGrant: 'finalize-token'
};

const twoFactor = { pendingToken: 'pending', methods: ['totp'], expiresInSeconds: 300 };

function login() {
	return performLogin({ email: 'm@thelemail.com', password: 'pw' });
}

function order(fn: { mock: { invocationCallOrder: number[] } }, call = 0): number {
	const at = fn.mock.invocationCallOrder[call];
	if (at === undefined) throw new Error('not called');
	return at;
}

beforeEach(() => {
	for (const group of [keystore, api, twofactor, accounts]) {
		for (const fn of Object.values(group)) fn.mockReset();
	}
	for (const fn of [session.addSession, session.forgetSession, session.setSession, session.loadProfile]) {
		fn.mockReset();
	}
	let ops = 0;
	keystore.opaqueStartAuth.mockImplementation(async () => ({ operationId: `op-${++ops}`, ke1: 'ke1' }));
	keystore.opaqueFinishAuth.mockResolvedValueOnce({ ok: false, code: 'invalid_credentials' }).mockResolvedValue({ ok: true, ke3: 'ke3' });
	keystore.opaqueAbandonOperation.mockResolvedValue(undefined);
	keystore.opaqueCompleteLoginUnlock.mockResolvedValue({ ok: true, accountId: ACCOUNT, email: 'm@thelemail.com' });
	keystore.prepareLogin.mockResolvedValue({ clientPublicEphemeral: 'A', clientProof: 'M1' });
	keystore.verifyLoginProof.mockResolvedValue({ ok: true });
	keystore.completeLoginUnlock.mockResolvedValue({ ok: true, accountId: ACCOUNT, email: 'm@thelemail.com' });
	keystore.migrationStartRegistration.mockResolvedValue({ ok: true, operationId: 'reg', registrationRequest: 'req' });
	keystore.migrationFinishStage.mockResolvedValue({
		ok: true,
		opaqueRecord: 'record',
		wrappedMasterKey: 'staged-wmk',
		masterKeyId: 'staged-mk',
		opaqueParamsVersion: 1,
		stagedEncryptedPrivateKey: 'staged-epk'
	});
	keystore.migrationFinalized.mockResolvedValue({ ok: true });
	keystore.getPublicKey.mockResolvedValue({ ok: true, publicKeyArmored: 'pub', fingerprint: FINGERPRINT, keyVersion: 1 });
	keystore.lock.mockResolvedValue(undefined);
	api.loginInit.mockImplementation(async (req: { ke1?: string }) => (req.ke1 ? opaqueInit : srpInit));
	api.loginComplete.mockImplementation(async (req: { ke3?: string }) => (req.ke3 ? stagedGrant : srpGrant));
	api.migrationRegistrationInit.mockResolvedValue({ registrationResponse: 'resp' });
	api.migrationStage.mockResolvedValue({ authScheme: 'srp_v1', migrationState: 'staged' });
	api.migrationFinalize.mockResolvedValue(undefined);
	api.getMe.mockResolvedValue({ accountId: ACCOUNT, keyFingerprint: 'ABCDEF01', keyVersion: 1 });
	accounts.load.mockResolvedValue(undefined);
	accounts.byId.mockReturnValue({ accountId: ACCOUNT, slot: 0, email: 'm@thelemail.com' });
	accounts.upsert.mockResolvedValue(undefined);
});

describe('an SRP account signing in on the auth origin', () => {
	it('stages OPAQUE, signs in again over it and finalizes in one sign-in', async () => {
		const outcome = await login();

		expect(outcome).toEqual({ status: 'complete', result: { accountId: ACCOUNT, slot: 0 } });
		expect(api.migrationStage).toHaveBeenCalledWith(expect.objectContaining({ grantToken: 'stage-token', opaqueRecord: 'record' }));
		expect(order(api.migrationStage)).toBeLessThan(order(keystore.lock));
		expect(order(keystore.lock)).toBeLessThan(order(keystore.opaqueStartAuth, 1));
		expect(keystore.opaqueCompleteLoginUnlock).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: 'op-2', serverAuthScheme: 'srp_v1' })
		);
		expect(api.migrationFinalize).toHaveBeenCalledWith({ finalizeToken: 'finalize-token' });
		expect(keystore.migrationFinalized).toHaveBeenCalledWith({ accountId: ACCOUNT });
		expect(session.addSession).toHaveBeenCalledTimes(1);
		expect(session.addSession).toHaveBeenCalledWith('opaque-token', 3600, ACCOUNT, undefined);
		expect(session.setSession).toHaveBeenCalledWith('opaque-token', 3600, ACCOUNT);
	});

	it('asks for the second factor again before it finalizes', async () => {
		api.loginComplete.mockImplementation(async (req: { ke3?: string }) =>
			req.ke3 ? { accountId: ACCOUNT, twoFactor } : { ...srpGrant, twoFactor, accessToken: undefined }
		);
		const first = await login();
		expect(first.status).toBe('twoFactorRequired');
		if (first.status !== 'twoFactorRequired') return;
		expect(first.pending.srpSalt).toBe('srp-salt');

		twofactor.verify2faTotp.mockResolvedValueOnce(srpGrant).mockResolvedValueOnce(stagedGrant);
		const second = await submitTwoFactorTotp(first.pending, '123456');
		expect(second.status).toBe('twoFactorRequired');
		if (second.status !== 'twoFactorRequired') return;
		expect(second.pending.opaqueOperationId).toBe('op-2');
		expect(api.migrationStage).toHaveBeenCalledTimes(1);
		expect(api.migrationFinalize).not.toHaveBeenCalled();

		const done = await submitTwoFactorTotp(second.pending, '654321');
		expect(done).toEqual({ status: 'complete', result: { accountId: ACCOUNT, slot: 0 } });
		expect(api.migrationFinalize).toHaveBeenCalledWith({ finalizeToken: 'finalize-token' });
	});

	it('stops with an unlock error and an empty vault when staging fails', async () => {
		api.migrationStage.mockRejectedValue(new ApiCallError(409, null, 'conflict'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(login()).rejects.toThrow();

		expect(keystore.lock).toHaveBeenCalledWith({ accountId: ACCOUNT });
		expect(keystore.opaqueStartAuth).toHaveBeenCalledTimes(1);
		expect(session.addSession).not.toHaveBeenCalled();
		expect(session.setSession).not.toHaveBeenCalled();
	});

	it('reports a wrong password through the server, not the vault', async () => {
		api.loginComplete.mockImplementation(async (req: { ke3?: string }) => {
			if (req.ke3) return stagedGrant;
			throw new ApiCallError(401, null, 'invalid credentials');
		});

		await expect(login()).rejects.toMatchObject({ status: 401 });

		expect(keystore.completeLoginUnlock).not.toHaveBeenCalled();
		expect(keystore.abandonLogin).toHaveBeenCalled();
	});
});
