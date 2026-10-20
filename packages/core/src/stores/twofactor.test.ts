import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TwoFactorStatus } from '$core/api/types';

const api = vi.hoisted(() => ({ getTwoFactorStatus: vi.fn() }));
vi.mock('$core/api/twofactor', () => api);

const { twofactor } = await import('./twofactor.svelte');

const on = { enabled: true, totp: null, webauthnCredentials: [] } as unknown as TwoFactorStatus;
const off = { enabled: false, totp: null, webauthnCredentials: [] } as unknown as TwoFactorStatus;

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

afterEach(() => {
	twofactor.setAccount(null);
	vi.clearAllMocks();
});

describe('twofactor store', () => {
	it('moves from unknown through loading to ready', async () => {
		twofactor.setAccount('a');
		expect(twofactor.phase).toBe('unknown');
		const d = deferred<TwoFactorStatus>();
		api.getTwoFactorStatus.mockReturnValueOnce(d.promise);

		const p = twofactor.load();
		expect(twofactor.phase).toBe('loading');
		expect(twofactor.enabled).toBe(false);
		d.resolve(on);
		await p;

		expect(twofactor.phase).toBe('ready');
		expect(twofactor.enabled).toBe(true);
		expect(api.getTwoFactorStatus).toHaveBeenCalledWith('a');
	});

	it('lands in error on failure and does not retry by itself', async () => {
		twofactor.setAccount('a');
		api.getTwoFactorStatus.mockRejectedValue(new Error('HTTP 500'));
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		twofactor.ensure('a');
		await vi.waitFor(() => expect(twofactor.phase).toBe('error'));
		twofactor.ensure('a');
		twofactor.ensure('a');

		expect(api.getTwoFactorStatus).toHaveBeenCalledTimes(1);
		expect(twofactor.status).toBeNull();
	});

	it('keeps the last known status when a refresh fails', async () => {
		twofactor.setAccount('a');
		api.getTwoFactorStatus.mockResolvedValueOnce(off).mockRejectedValueOnce(new Error('HTTP 503'));
		vi.spyOn(console, 'warn').mockImplementation(() => {});

		await twofactor.load();
		await twofactor.load();

		expect(twofactor.phase).toBe('error');
		expect(twofactor.status).toEqual(off);
	});

	it('returns to unknown on account switch and drops the old account response', async () => {
		twofactor.setAccount('a');
		const d = deferred<TwoFactorStatus>();
		api.getTwoFactorStatus.mockReturnValueOnce(d.promise);
		const p = twofactor.load();

		twofactor.setAccount('b');
		expect(twofactor.phase).toBe('unknown');
		d.resolve(on);
		await p;

		expect(twofactor.phase).toBe('unknown');
		expect(twofactor.status).toBeNull();
	});
});
