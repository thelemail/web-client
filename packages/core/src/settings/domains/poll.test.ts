import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollWhileVisible } from './poll';

let visibility: DocumentVisibilityState = 'visible';

function show(next: DocumentVisibilityState) {
	visibility = next;
	document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
	visibility = 'visible';
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => visibility
	});
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('pollWhileVisible', () => {
	it('runs on the interval while the page is visible', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const stop = pollWhileVisible(run, 30_000);

		await vi.advanceTimersByTimeAsync(29_000);
		expect(run).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(31_000);
		expect(run).toHaveBeenCalledTimes(2);
		stop();
	});

	it('pauses while hidden and runs again once shown', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const stop = pollWhileVisible(run, 30_000);

		show('hidden');
		await vi.advanceTimersByTimeAsync(90_000);
		expect(run).not.toHaveBeenCalled();

		show('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(run).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(30_000);
		expect(run).toHaveBeenCalledTimes(2);
		stop();
	});

	it('keeps polling after a failed run', async () => {
		const run = vi.fn().mockRejectedValue(new Error('offline'));
		const stop = pollWhileVisible(run, 30_000);

		await vi.advanceTimersByTimeAsync(90_000);
		expect(run).toHaveBeenCalledTimes(3);
		stop();
	});

	it('never overlaps a run that is still going', async () => {
		let release: () => void = () => {};
		const run = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				})
		);
		const stop = pollWhileVisible(run, 30_000);

		await vi.advanceTimersByTimeAsync(30_000);
		expect(run).toHaveBeenCalledTimes(1);

		show('hidden');
		show('visible');
		await vi.advanceTimersByTimeAsync(120_000);
		expect(run).toHaveBeenCalledTimes(1);

		release();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(run).toHaveBeenCalledTimes(2);
		stop();
	});

	it('stops for good after cleanup', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const stop = pollWhileVisible(run, 30_000);
		stop();

		show('hidden');
		show('visible');
		await vi.advanceTimersByTimeAsync(120_000);
		expect(run).not.toHaveBeenCalled();
	});
});
