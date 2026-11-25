import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

const moved = vi.hoisted(() => ({ signInMovedToAuth: vi.fn(async () => true) }));
const handoff = vi.hoisted(() => ({ startFor: vi.fn(() => new Promise<never>(() => {})) }));

vi.mock('$core/custody/unlock', () => moved);
vi.mock('$core/producthandoff/fallback', () => handoff);
vi.mock('$core/auth/RegisterFlow.svelte', () => ({ default: () => {} }));
vi.mock('$platform', () => ({ platform: { returnOrigin: () => 'http://localhost', openExternal: vi.fn() } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { params: {}, url: new URL('http://localhost/register?plan=family&billing=monthly&src=pricing') } }));

import RegisterPage from './+page.svelte';

afterEach(() => cleanup());

describe('mail registration once sign-in has moved to the account origin', () => {
	it('registers through the account origin and keeps the chosen plan', async () => {
		render(RegisterPage);
		await vi.waitFor(() =>
			expect(handoff.startFor).toHaveBeenCalledWith(null, '/', 'register', '?plan=family&billing=monthly&src=pricing')
		);
	});
});
