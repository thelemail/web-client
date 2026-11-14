import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterBoot } from './idle';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('afterBoot', () => {
	it('waits out the boot period before asking for idle time', () => {
		const idle = vi.fn((cb: () => void) => {
			cb();
			return 1;
		});
		vi.stubGlobal('requestIdleCallback', idle);
		vi.stubGlobal('cancelIdleCallback', vi.fn());
		const work = vi.fn();
		afterBoot(work);
		vi.advanceTimersByTime(1999);
		expect(idle).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(idle).toHaveBeenCalledWith(work, { timeout: 5000 });
		expect(work).toHaveBeenCalledTimes(1);
	});

	it('runs after the boot period where idle callbacks are missing', () => {
		vi.stubGlobal('requestIdleCallback', undefined);
		const work = vi.fn();
		afterBoot(work);
		vi.advanceTimersByTime(2000);
		expect(work).toHaveBeenCalledTimes(1);
	});

	it('cancels before and after the boot period', () => {
		const cancelIdle = vi.fn();
		vi.stubGlobal('requestIdleCallback', vi.fn(() => 7));
		vi.stubGlobal('cancelIdleCallback', cancelIdle);
		const work = vi.fn();
		afterBoot(work)();
		vi.advanceTimersByTime(5000);
		expect(work).not.toHaveBeenCalled();
		const cancel = afterBoot(work);
		vi.advanceTimersByTime(2000);
		cancel();
		expect(cancelIdle).toHaveBeenCalledWith(7);
		expect(work).not.toHaveBeenCalled();
	});
});
