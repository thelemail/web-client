import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveAvatars = vi.fn();

vi.mock('$lib/api/accounts', () => ({
	resolveAvatars: (...a: unknown[]) => resolveAvatars(...a)
}));

import { personAvatars } from './personAvatars.svelte';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('personAvatars', () => {
	beforeEach(() => {
		resolveAvatars.mockReset();
		personAvatars.setAccount(null);
		personAvatars.setAccount('acct-1');
	});

	it('batches every address read in one pass into a single request', async () => {
		resolveAvatars.mockResolvedValue({
			avatars: [{ address: 'bob@example.com', avatarUrl: 'https://blob/bob' }]
		});

		expect(personAvatars.avatarUrl('bob@example.com')).toBeNull();
		expect(personAvatars.avatarUrl('carol@example.com')).toBeNull();
		await settle();

		expect(resolveAvatars).toHaveBeenCalledTimes(1);
		expect(resolveAvatars).toHaveBeenCalledWith(['bob@example.com', 'carol@example.com']);
		expect(personAvatars.avatarUrl('bob@example.com')).toBe('https://blob/bob');
	});

	it('caches a miss so an address without an avatar is asked for once', async () => {
		resolveAvatars.mockResolvedValue({ avatars: [] });

		personAvatars.avatarUrl('ghost@example.com');
		await settle();
		personAvatars.avatarUrl('ghost@example.com');
		await settle();

		expect(resolveAvatars).toHaveBeenCalledTimes(1);
		expect(personAvatars.avatarUrl('ghost@example.com')).toBeNull();
	});

	it('does not re-request an address while its batch is still in flight', async () => {
		let release: (v: unknown) => void = () => {};
		resolveAvatars.mockReturnValue(new Promise((r) => (release = r)));

		personAvatars.avatarUrl('bob@example.com');
		await settle();
		personAvatars.avatarUrl('bob@example.com');
		await settle();

		expect(resolveAvatars).toHaveBeenCalledTimes(1);
		release({ avatars: [] });
	});

	it('keys on the lowercased address', async () => {
		resolveAvatars.mockResolvedValue({
			avatars: [{ address: 'Bob@Example.com', avatarUrl: 'https://blob/bob' }]
		});

		personAvatars.avatarUrl('BOB@example.com');
		await settle();

		expect(resolveAvatars).toHaveBeenCalledWith(['bob@example.com']);
		expect(personAvatars.avatarUrl('bob@example.com')).toBe('https://blob/bob');
	});

	it('forgets everything when the account changes', async () => {
		resolveAvatars.mockResolvedValue({
			avatars: [{ address: 'bob@example.com', avatarUrl: 'https://blob/bob' }]
		});
		personAvatars.avatarUrl('bob@example.com');
		await settle();
		expect(personAvatars.avatarUrl('bob@example.com')).toBe('https://blob/bob');

		personAvatars.setAccount('acct-2');
		expect(personAvatars.avatarUrl('bob@example.com')).toBeNull();
	});

	it('resolves nothing until an account is set', () => {
		personAvatars.setAccount(null);
		expect(personAvatars.avatarUrl('bob@example.com')).toBeNull();
		expect(resolveAvatars).not.toHaveBeenCalled();
	});
});
