import { beforeEach, describe, expect, it, vi } from 'vitest';

const ks = vi.hoisted(() => ({
	getPublicKey: vi.fn(),
	encrypt: vi.fn(),
	signDetached: vi.fn()
}));
const own = vi.hoisted(() => ({ require: vi.fn() }));

vi.mock('openpgp', () => ({}));
vi.mock('$core/calendar/seal', () => ({ SealError: class extends Error {} }));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: ks }));
vi.mock('$core/stores/accountKeys.svelte', () => ({
	requireConfirmedOwnKey: (...a: unknown[]) => own.require(...a)
}));
vi.mock('$core/keys/forwardingKey', () => ({
	armorDetachedSignature: vi.fn(),
	authorizationTimestamp: vi.fn(),
	canonicaliseAuthorization: vi.fn(),
	generateForwardingKey: vi.fn()
}));


const refused = new Error('key not confirmed');

describe('writes that use the account key while it is not confirmed', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		own.require.mockRejectedValue(refused);
	});

	it('do not sign busy windows', async () => {
		const { signBusyWindows } = await import('$core/calendar/busysign');
		await expect(
			signBusyWindows('acc', {
				calendarId: 'c',
				itemId: 'i',
				privacy: 'busy',
				rev: 1,
				signerAccountId: 'acc',
				windows: []
			} as unknown as never)
		).rejects.toBe(refused);
		expect(own.require).toHaveBeenCalledWith('acc');
		expect(ks.signDetached).not.toHaveBeenCalled();
	});

	it('do not seal a mail signature', async () => {
		const { sealSignature } = await import('$core/mail/signatureCrypto');
		await expect(
			sealSignature({ accountId: 'acc' }, { html: '<p>Ada</p>' } as unknown as never, {
				enabled: true,
				appendOnReply: true
			})
		).rejects.toBe(refused);
		expect(ks.encrypt).not.toHaveBeenCalled();
	});

	it('do not sign a forwarding authorization', async () => {
		const { prepareForwarding } = await import('$core/settings/forwarding/authorize');
		await expect(prepareForwarding('acc', 'ada@thelemail.test', 'ada@example.test')).rejects.toBe(refused);
		expect(ks.getPublicKey).not.toHaveBeenCalled();
		expect(ks.signDetached).not.toHaveBeenCalled();
	});
});
