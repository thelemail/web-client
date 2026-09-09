import { describe, expect, it, vi, beforeEach } from 'vitest';

const openProductFork = vi.fn();
const consumeSessionFork = vi.fn();

vi.mock('./keystore/keystore-client', () => ({ keystore: { openProductFork } }));
vi.mock('./api/forks', () => ({ consumeSessionFork, produceSessionFork: vi.fn() }));
vi.mock('./products', () => ({
	currentProduct: 'calendar',
	productTarget: () => null,
	appOrigin: () => '/',
	handOffToApp: () => undefined
}));

const tryRefresh = vi.fn();
vi.mock('./stores/auth.svelte', () => ({ auth: { tryRefresh } }));

const VICTIM = 'ea2d5f2c-e0dd-4b86-b01e-93f72f643ee6';
const ATTACKER = '11111111-2222-3333-4444-555555555555';

describe('adoptFork', () => {
	beforeEach(() => {
		openProductFork.mockReset();
		consumeSessionFork.mockReset();
		tryRefresh.mockReset();
		tryRefresh.mockResolvedValue(true);
	});

	it('installs keys under the account the server names, never the one in the payload', async () => {
		const { adoptFork } = await import('./fork');
		consumeSessionFork.mockResolvedValue({
			accountId: ATTACKER,
			audience: 'calendar',
			payload: 'ciphertext-naming-the-victim'
		});
		openProductFork.mockResolvedValue({
			ok: true,
			accountId: ATTACKER,
			email: 'attacker@thelemail.com',
			keyCount: 1
		});

		await adoptFork('#selector=s&key=k');

		expect(openProductFork).toHaveBeenCalledWith(
			expect.objectContaining({ accountId: ATTACKER })
		);
		expect(openProductFork.mock.calls[0][0].accountId).not.toBe(VICTIM);
	});

	it('surfaces the keystore refusing a payload that names a different account', async () => {
		const { adoptFork, ForkError } = await import('./fork');
		consumeSessionFork.mockResolvedValue({
			accountId: ATTACKER,
			audience: 'calendar',
			payload: 'ciphertext-naming-the-victim'
		});
		openProductFork.mockResolvedValue({ ok: false, code: 'wrong_account' });

		await expect(adoptFork('#selector=s&key=k')).rejects.toBeInstanceOf(ForkError);
	});

	it('refuses a fork issued for another product', async () => {
		const { adoptFork, ForkError } = await import('./fork');
		consumeSessionFork.mockResolvedValue({ accountId: VICTIM, audience: 'drive', payload: 'x' });
		await expect(adoptFork('#selector=s&key=k')).rejects.toBeInstanceOf(ForkError);
		expect(openProductFork).not.toHaveBeenCalled();
	});

	it('refuses a fork for an account this browser has no session for', async () => {
		const { adoptFork, ForkError } = await import('./fork');
		consumeSessionFork.mockResolvedValue({
			accountId: ATTACKER,
			audience: 'calendar',
			payload: 'ciphertext'
		});
		tryRefresh.mockResolvedValue(false);

		await expect(adoptFork('#selector=s&key=k')).rejects.toBeInstanceOf(ForkError);
		expect(openProductFork).not.toHaveBeenCalled();
	});

	it('proves the session for the account the server names, before opening anything', async () => {
		const { adoptFork } = await import('./fork');
		consumeSessionFork.mockResolvedValue({
			accountId: ATTACKER,
			audience: 'calendar',
			payload: 'ciphertext'
		});
		openProductFork.mockResolvedValue({
			ok: true,
			accountId: ATTACKER,
			email: 'a@thelemail.com',
			keyCount: 1
		});

		await adoptFork('#selector=s&key=k');

		expect(tryRefresh).toHaveBeenCalledWith(ATTACKER);
		expect(tryRefresh.mock.invocationCallOrder[0]).toBeLessThan(
			openProductFork.mock.invocationCallOrder[0]
		);
	});
});
