import { beforeEach, describe, expect, it, vi } from 'vitest';

const replaceState = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ replaceState }));
vi.mock('$app/state', () => ({ page: { state: {} } }));

import { showStepInUrl } from './stepUrl';

beforeEach(() => {
	replaceState.mockReset();
	history.replaceState({}, '', '/u/0/settings/domains/d1?step=routing');
});

describe('showStepInUrl', () => {
	it('writes a clamped step into the address bar', () => {
		showStepInUrl('sending');

		expect(replaceState).toHaveBeenCalledTimes(1);
		const url = replaceState.mock.calls[0][0] as URL;
		expect(url.pathname).toBe('/u/0/settings/domains/d1');
		expect(url.searchParams.get('step')).toBe('sending');
	});

	it('leaves the address bar alone when it already shows the step', () => {
		showStepInUrl('routing');

		expect(replaceState).not.toHaveBeenCalled();
	});
});
