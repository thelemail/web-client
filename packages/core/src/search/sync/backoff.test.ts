import { describe, expect, it } from 'vitest';
import { BACKOFF_CAP_MS, backoffDelay } from './backoff';

describe('backoffDelay', () => {
	it('uses full jitter under an exponential ceiling capped at a minute', () => {
		expect(backoffDelay(0, null, () => 0.999)).toBe(999);
		expect(backoffDelay(3, null, () => 0.5)).toBe(4000);
		expect(backoffDelay(20, null, () => 0.999)).toBe(Math.floor(0.999 * BACKOFF_CAP_MS));
		expect(backoffDelay(5, null, () => 0)).toBe(0);
	});

	it('honours Retry-After over the jittered delay', () => {
		expect(backoffDelay(0, 7, () => 0.1)).toBe(7000);
		expect(backoffDelay(10, 120, () => 0.1)).toBe(120_000);
	});
});
