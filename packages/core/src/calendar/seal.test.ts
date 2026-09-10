import { describe, expect, it, vi, beforeEach } from 'vitest';

const publicKeyFor = vi.fn();
const ready = vi.fn();
const load = vi.fn();
const getPublicKey = vi.fn();
const senderKey = vi.fn();

vi.mock('$core/stores/calendarKeys.svelte', () => ({
	calendarKeys: { ready, load, publicKeyFor }
}));
vi.mock('$core/stores/aliasKeys.svelte', () => ({ aliasKeys: { ready: vi.fn(), load: vi.fn() } }));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { getPublicKey } }));
vi.mock('$core/mail/send', () => ({ senderKey }));
vi.mock('$core/crypto', () => ({
	b64ToBytes: (v: string) => new Uint8Array(),
	bytesToB64: () => ''
}));

const CALENDAR_KEY = { publicKeyArmored: 'cal-pub', fingerprintB64: 'Y2Fs', fingerprintHex: 'ca1' };
const ACCOUNT_KEY = { publicKeyArmored: 'mail-pub', fingerprintB64: 'bWFpbA', fingerprintHex: 'ma11' };

describe('keyForCalendar', () => {
	beforeEach(() => {
		publicKeyFor.mockReset();
		ready.mockReset().mockResolvedValue(undefined);
		load.mockReset().mockResolvedValue(undefined);
		senderKey.mockReset().mockResolvedValue(ACCOUNT_KEY);
	});

	it('seals a personal calendar with that calendar own key, not the account key', async () => {
		const { keyForCalendar } = await import('./seal');
		publicKeyFor.mockReturnValue(CALENDAR_KEY);

		const key = await keyForCalendar('acct', {
			id: 'cal-1',
			kind: 'personal',
			keyFingerprint: 'Y2Fs'
		} as never);

		expect(key.fingerprintB64).toBe('Y2Fs');
		expect(key.fingerprintB64).not.toBe(ACCOUNT_KEY.fingerprintB64);
		expect(senderKey).not.toHaveBeenCalled();
	});

	it('refuses to seal a personal calendar when its key is not held', async () => {
		const { keyForCalendar, SealError } = await import('./seal');
		publicKeyFor.mockReturnValue(null);

		await expect(
			keyForCalendar('acct', { id: 'cal-1', kind: 'personal' } as never)
		).rejects.toBeInstanceOf(SealError);
		expect(senderKey).not.toHaveBeenCalled();
	});

	it('still seals a shared calendar with its calendar key', async () => {
		const { keyForCalendar } = await import('./seal');
		publicKeyFor.mockReturnValue(CALENDAR_KEY);

		const key = await keyForCalendar('acct', {
			id: 'cal-2',
			kind: 'shared',
			keyFingerprint: 'Y2Fs'
		} as never);
		expect(key.fingerprintB64).toBe('Y2Fs');
	});
});
