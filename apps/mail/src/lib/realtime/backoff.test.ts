import { describe, it, expect } from 'vitest';
import { nextDelay } from './backoff';

describe('nextDelay', () => {
	it('returns roughly the base delay at attempt 0', () => {
		const d = nextDelay(0, { baseMs: 1000, jitter: 0 }, () => 0.5);
		expect(d).toBe(1000);
	});

	it('grows with attempt count', () => {
		const a = nextDelay(0, { jitter: 0 }, () => 0.5);
		const b = nextDelay(1, { jitter: 0 }, () => 0.5);
		const c = nextDelay(2, { jitter: 0 }, () => 0.5);
		expect(b).toBeGreaterThan(a);
		expect(c).toBeGreaterThan(b);
	});

	it('caps at maxMs', () => {
		const d = nextDelay(20, { baseMs: 1000, maxMs: 30000, jitter: 0 }, () => 0.5);
		expect(d).toBe(30000);
	});

	it('stays within the jitter range', () => {
		const base = 1000;
		const jitter = 0.3;
		for (const r of [0, 0.25, 0.5, 0.75, 1]) {
			const d = nextDelay(0, { baseMs: base, jitter }, () => r);
			expect(d).toBeGreaterThanOrEqual(base * (1 - jitter));
			expect(d).toBeLessThanOrEqual(base * (1 + jitter));
		}
	});

	it('is deterministic given an injected random function', () => {
		const a = nextDelay(3, {}, () => 0.42);
		const b = nextDelay(3, {}, () => 0.42);
		expect(a).toBe(b);
	});

	it('never goes negative', () => {
		const d = nextDelay(0, { baseMs: 10, jitter: 1 }, () => 0);
		expect(d).toBeGreaterThanOrEqual(0);
	});
});
