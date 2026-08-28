import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { coalesce } from './coalesce';

describe('coalesce', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('collapses many calls in the window into one invocation', () => {
		const fn = vi.fn();
		const trigger = coalesce(fn, 750);
		for (let i = 0; i < 10; i++) trigger();
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(750);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('starts a new batch after the window elapses', () => {
		const fn = vi.fn();
		const trigger = coalesce(fn, 100);
		trigger();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
		trigger();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('does not fire early', () => {
		const fn = vi.fn();
		const trigger = coalesce(fn, 500);
		trigger();
		vi.advanceTimersByTime(499);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
