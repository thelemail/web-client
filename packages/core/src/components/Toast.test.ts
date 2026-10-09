import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import Toast from './Toast.svelte';

describe('Toast', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	function liveText(): string | null {
		return document.querySelector('[role="status"][aria-live="polite"]')?.textContent ?? null;
	}

	it('reads its text out through a polite live region', async () => {
		render(Toast, { props: { text: 'Moved to Archive' } });
		await vi.advanceTimersByTimeAsync(150);
		expect(liveText()).toBe('Moved to Archive');
	});

	it('announces a new message when the text changes', async () => {
		const { rerender } = render(Toast, { props: { text: 'Moved to Archive' } });
		await vi.advanceTimersByTimeAsync(150);
		await rerender({ text: 'Moved to Trash' });
		await vi.advanceTimersByTimeAsync(150);
		expect(liveText()).toBe('Moved to Trash');
	});
});
