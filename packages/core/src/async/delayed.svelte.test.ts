import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { delayed, INDICATOR_DELAY_MS, INDICATOR_MIN_MS, type Delayed } from './delayed.svelte';

describe('delayed', () => {
	let active = $state(false);
	let key = $state<unknown>('a');
	let cleanup: (() => void) | undefined;
	let d: Delayed;

	beforeEach(() => {
		vi.useFakeTimers();
		active = false;
		key = 'a';
		cleanup = $effect.root(() => {
			d = delayed(() => active, { key: () => key });
		});
		flushSync();
	});

	afterEach(() => {
		cleanup?.();
		vi.useRealTimers();
	});

	async function advance(ms: number) {
		await vi.advanceTimersByTimeAsync(ms);
		flushSync();
	}

	it('stays hidden for work that ends before the delay', async () => {
		active = true;
		flushSync();
		await advance(INDICATOR_DELAY_MS - 1);
		expect(d.visible).toBe(false);
		active = false;
		flushSync();
		await advance(INDICATOR_DELAY_MS * 2);
		expect(d.visible).toBe(false);
	});

	it('shows once the delay passes', async () => {
		active = true;
		flushSync();
		await advance(INDICATOR_DELAY_MS - 1);
		expect(d.visible).toBe(false);
		await advance(1);
		expect(d.visible).toBe(true);
	});

	it('keeps the indicator for the minimum time once shown', async () => {
		active = true;
		flushSync();
		await advance(INDICATOR_DELAY_MS);
		expect(d.visible).toBe(true);
		active = false;
		flushSync();
		await advance(INDICATOR_MIN_MS - 1);
		expect(d.visible).toBe(true);
		await advance(1);
		expect(d.visible).toBe(false);
	});

	it('hides at once when the key changes and waits again for the new key', async () => {
		active = true;
		flushSync();
		await advance(INDICATOR_DELAY_MS);
		expect(d.visible).toBe(true);
		key = 'b';
		flushSync();
		expect(d.visible).toBe(false);
		await advance(INDICATOR_DELAY_MS - 1);
		expect(d.visible).toBe(false);
		await advance(1);
		expect(d.visible).toBe(true);
	});

	it('does not stay visible for a key whose work already finished', async () => {
		active = true;
		flushSync();
		await advance(INDICATOR_DELAY_MS);
		key = 'b';
		active = false;
		flushSync();
		expect(d.visible).toBe(false);
		key = 'a';
		flushSync();
		expect(d.visible).toBe(false);
	});
});
