import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiBlobFetch = vi.fn();

vi.mock('$app/env', () => ({ browser: true }));
vi.mock('$core/api/client', () => ({ apiBlobFetch: (...a: unknown[]) => apiBlobFetch(...a) }));

import { cacheAccountAvatar, cachePersonAvatar } from './avatarCache.svelte';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

beforeEach(() => {
	apiBlobFetch.mockReset();
	apiBlobFetch.mockResolvedValue(new Response(png));
});

describe('avatar fetches', () => {
	it('reads the account avatar through the api as that account', async () => {
		await cacheAccountAvatar('acct-1', '/v1/avatars/acct-1/a.png');

		expect(apiBlobFetch).toHaveBeenCalledWith('/v1/avatars/acct-1/a.png', { accountId: 'acct-1' });
	});

	it('reads a contact avatar through the api as the viewing account', async () => {
		await cachePersonAvatar('acct-1', 'bob@example.com', '/v1/avatars/acct-9/b.png');

		expect(apiBlobFetch).toHaveBeenCalledWith('/v1/avatars/acct-9/b.png', { accountId: 'acct-1' });
	});

	it('shows no avatar when the api refuses it', async () => {
		apiBlobFetch.mockRejectedValue(new Error('HTTP 404'));

		await expect(cachePersonAvatar('acct-1', 'eve@example.com', '/v1/avatars/x/y.png')).resolves.toBeNull();
	});
});
