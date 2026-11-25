import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$platform', () => ({ platform: { returnOrigin: () => 'http://localhost', openExternal: vi.fn() } }));
vi.mock('$core/api/billing', () => ({ createCheckoutSession: vi.fn() }));
vi.mock('$core/api/workspaces', () => ({ changeMyWorkspaceType: vi.fn() }));

const { checkoutRoute, orderFromQuery } = await import('./register-checkout');

describe('paid registration hand-back', () => {
	it('round-trips the order through the mail route', () => {
		const order = { planCode: 'family_plus' as const, interval: 'year' as const, seats: 4, workspaceType: 'family' as const };
		const route = checkoutRoute(2, order);
		expect(route.startsWith('/u/2/billing/start?')).toBe(true);
		expect(orderFromQuery(new URL(`http://x${route}`).searchParams)).toEqual(order);
	});

	it('refuses anything that is not a real paid order', () => {
		for (const q of ['plan=free&interval=month&type=personal', 'plan=family&interval=week&type=family', 'plan=family&interval=month&type=team', 'plan=team&interval=month&type=business&seats=0']) {
			expect(orderFromQuery(new URLSearchParams(q)), q).toBeNull();
		}
	});
});
