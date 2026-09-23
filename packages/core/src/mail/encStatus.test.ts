import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
	classify: vi.fn(),
	lookup: vi.fn()
}));

vi.mock('./sendDispatch', () => ({ classifyAddress: api.classify }));
vi.mock('$core/api/externalKeys', () => ({ lookupExternalKey: api.lookup }));

import { ApiCallError } from '$core/api/types';
import { EncStatusTracker } from './encStatus.svelte';

const KEYED = { address: 'a@acme.test', status: 'pinned', fingerprint: 'fp', armoredKey: 'key' };

beforeEach(() => {
	api.classify.mockReset().mockResolvedValue('external');
	api.lookup.mockReset();
});

describe('EncStatusTracker', () => {
	it('marks a recipient with no published key as cleartext', async () => {
		api.lookup.mockRejectedValue(new ApiCallError(404, null, 'not found'));
		const t = new EncStatusTracker();

		await t.settle(['taras@spribe.test']);

		expect(t.statusFor('taras@spribe.test')).toBe('cleartext');
	});

	it('settles on failed instead of checking forever when the lookup errors', async () => {
		api.lookup.mockRejectedValue(new ApiCallError(500, null, 'boom'));
		const t = new EncStatusTracker();

		await t.settle(['taras@spribe.test']);

		expect(t.statusFor('taras@spribe.test')).toBe('failed');
	});

	it('settles on failed when classifying the address errors', async () => {
		api.classify.mockRejectedValue(new Error('offline'));
		const t = new EncStatusTracker();

		await t.settle(['taras@spribe.test']);

		expect(t.statusFor('taras@spribe.test')).toBe('failed');
		expect(api.lookup).not.toHaveBeenCalled();
	});

	it('checks a failed recipient again on the next track', async () => {
		api.lookup.mockRejectedValueOnce(new ApiCallError(503, null, 'down')).mockResolvedValue(KEYED);
		const t = new EncStatusTracker();
		await t.settle(['a@acme.test']);
		expect(t.statusFor('a@acme.test')).toBe('failed');

		t.track(['a@acme.test']);
		expect(t.statusFor('a@acme.test')).toBe('checking');
		await t.settle(['a@acme.test']);

		expect(t.statusFor('a@acme.test')).toBe('encrypted');
		expect(api.lookup).toHaveBeenCalledTimes(2);
	});

	it('does not look up a resolved recipient again', async () => {
		api.lookup.mockResolvedValue(KEYED);
		const t = new EncStatusTracker();
		await t.settle(['a@acme.test']);

		t.track(['A@acme.test']);
		await t.settle(['a@acme.test']);

		expect(api.lookup).toHaveBeenCalledTimes(1);
	});

	it('waits for a lookup already in flight', async () => {
		let resolve: (v: typeof KEYED) => void = () => {};
		api.lookup.mockReturnValue(new Promise((r) => (resolve = r)));
		const t = new EncStatusTracker();
		t.track(['a@acme.test']);

		const settled = t.settle(['a@acme.test']);
		resolve(KEYED);
		await settled;

		expect(t.statusFor('a@acme.test')).toBe('encrypted');
		expect(api.lookup).toHaveBeenCalledTimes(1);
	});

	it('marks internal recipients without an external lookup', async () => {
		api.classify.mockResolvedValue('internal');
		const t = new EncStatusTracker();

		await t.settle(['bob@thelemail.test']);

		expect(t.statusFor('bob@thelemail.test')).toBe('internal');
		expect(api.lookup).not.toHaveBeenCalled();
	});
});
