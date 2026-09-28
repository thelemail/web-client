import { describe, it, expect, vi, beforeEach } from 'vitest';

const ACCOUNT = '120792e5-d313-4c0e-aa94-4a4b00cab094';

const state = vi.hoisted(() => ({
	scheme: 'opaque_v1' as 'opaque_v1' | 'srp_v1',
	finishOk: true,
	initCalls: [] as unknown[],
	confirmCalls: [] as unknown[],
	abandoned: [] as string[]
}));

vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		status: async () => ({ accounts: [{ accountId: ACCOUNT, authScheme: state.scheme }] }),
		opaqueStartAuth: async () => ({ operationId: 'op-1', ke1: 'ke1' }),
		opaqueFinishAuth: async () =>
			state.finishOk ? { ok: true, ke3: 'ke3' } : { ok: false, code: 'invalid_credentials' },
		opaqueAbandonOperation: async ({ operationId }: { operationId: string }) => {
			state.abandoned.push(operationId);
		}
	}
}));

vi.mock('$core/api/twofactor', () => ({
	stepUpOpaqueInit: async (req: unknown, accountId: string) => {
		state.initCalls.push({ req, accountId });
		return { challengeId: 'ch-1', ke2: 'ke2', challengeTtlSeconds: 60 };
	},
	stepUpOpaqueConfirm: async (req: unknown, accountId: string) => {
		state.confirmCalls.push({ req, accountId });
		return { grant: 'grant-1', grantExpiresInSeconds: 300 };
	}
}));

import { enrollmentStepUp } from './enrollment-step-up';

describe('enrollmentStepUp', () => {
	beforeEach(() => {
		state.scheme = 'opaque_v1';
		state.finishOk = true;
		state.initCalls = [];
		state.confirmCalls = [];
		state.abandoned = [];
	});

	it('returns the grant after password and factor are confirmed', async () => {
		const res = await enrollmentStepUp({
			accountId: ACCOUNT,
			password: 'pw',
			action: 'webauthn_enroll',
			proof: async () => ({ method: 'totp', code: '123456' })
		});
		expect(res).toEqual({ ok: true, grant: 'grant-1' });
		expect(state.initCalls).toEqual([{ req: { ke1: 'ke1', action: 'webauthn_enroll' }, accountId: ACCOUNT }]);
		expect(state.confirmCalls).toEqual([
			{
				req: {
					challengeId: 'ch-1',
					ke3: 'ke3',
					action: 'webauthn_enroll',
					proof: { method: 'totp', code: '123456' }
				},
				accountId: ACCOUNT
			}
		]);
		expect(state.abandoned).toEqual(['op-1']);
	});

	it('omits the proof when two-factor is off', async () => {
		await enrollmentStepUp({
			accountId: ACCOUNT,
			password: 'pw',
			action: 'totp_enroll',
			proof: async () => null
		});
		expect(state.confirmCalls).toEqual([
			{ req: { challengeId: 'ch-1', ke3: 'ke3', action: 'totp_enroll' }, accountId: ACCOUNT }
		]);
	});

	it('stops before confirming when the password is wrong', async () => {
		state.finishOk = false;
		const proof = vi.fn(async () => null);
		const res = await enrollmentStepUp({ accountId: ACCOUNT, password: 'nope', action: 'totp_enroll', proof });
		expect(res).toEqual({ ok: false, reason: 'password' });
		expect(proof).not.toHaveBeenCalled();
		expect(state.confirmCalls).toEqual([]);
		expect(state.abandoned).toEqual(['op-1']);
	});

	it('refuses SRP accounts without contacting the server', async () => {
		state.scheme = 'srp_v1';
		const res = await enrollmentStepUp({
			accountId: ACCOUNT,
			password: 'pw',
			action: 'totp_enroll',
			proof: async () => null
		});
		expect(res).toEqual({ ok: false, reason: 'scheme' });
		expect(state.initCalls).toEqual([]);
	});
});
