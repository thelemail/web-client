import { describe, expect, it, vi } from 'vitest';

vi.mock('./keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('./api/forks', () => ({ consumeSessionFork: vi.fn(), produceSessionFork: vi.fn() }));
vi.mock('./products', () => ({ currentProduct: 'app', productTarget: () => null, appOrigin: () => '/', handOffToApp: () => undefined }));
vi.mock('./stores/auth.svelte', () => ({ auth: {} }));

describe('localForkPath in mail', () => {
	it('lands on the inbox when the handoff carries no path of its own', async () => {
		const { localForkPath } = await import('./fork');
		expect(localForkPath('/', 2)).toBe('/u/2/mail/inbox');
		expect(localForkPath('/u/4', 0)).toBe('/u/0/mail/inbox');
	});

	it('keeps the path the account was on and moves it to the local slot', async () => {
		const { localForkPath } = await import('./fork');
		expect(localForkPath('/u/7/mail/sent', 1)).toBe('/u/1/mail/sent');
		expect(localForkPath('/settings/security', 3)).toBe('/u/3/settings/security');
	});
});
