import { beforeEach, describe, expect, it, vi } from 'vitest';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: { state: {} } }));

import { showStepInUrl } from './stepUrl';

beforeEach(() => {
	goto.mockReset();
	history.replaceState({}, '', '/u/0/settings/domains/d1?step=routing');
});

describe('showStepInUrl', () => {
	it('writes a clamped step into the address bar', () => {
		showStepInUrl('sending');

		expect(goto).toHaveBeenCalledTimes(1);
		const [url, options] = goto.mock.calls[0] as [URL, object];
		expect(options).toEqual({ shallow: true, replace: true, state: {} });
		expect(url.pathname).toBe('/u/0/settings/domains/d1');
		expect(url.searchParams.get('step')).toBe('sending');
	});

	it('leaves the address bar alone when it already shows the step', () => {
		showStepInUrl('routing');

		expect(goto).not.toHaveBeenCalled();
	});
});
