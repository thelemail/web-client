import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import CopyBtn from './CopyBtn.svelte';

function stubClipboard(writeText?: (text: string) => Promise<void>) {
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: writeText ? { writeText } : undefined
	});
}

function btn() {
	return document.querySelector<HTMLButtonElement>('.copy-btn')!;
}

function live() {
	return document.querySelector('[aria-live="polite"]')?.textContent ?? '';
}

async function click() {
	await fireEvent.click(btn());
	await vi.waitFor(() => expect(btn().classList.contains('done') || btn().classList.contains('failed')).toBe(true));
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	stubClipboard();
});

describe('CopyBtn', () => {
	it('reports a copy once the clipboard accepts the text', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		stubClipboard(writeText);
		render(CopyBtn, { text: 'v=spf1 -all' });
		await click();

		expect(writeText).toHaveBeenCalledWith('v=spf1 -all');
		expect(btn().classList.contains('done')).toBe(true);
		expect(btn().textContent).toContain('Copied');
		expect(live()).toBe('Copied');
	});

	it('reports a failure when the clipboard refuses', async () => {
		stubClipboard(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));
		render(CopyBtn, { text: 'x' });
		await click();

		expect(btn().classList.contains('done')).toBe(false);
		expect(btn().classList.contains('failed')).toBe(true);
		expect(btn().textContent).not.toContain('Copied');
		expect(live()).toBe('Couldn’t copy');
	});

	it('reports a failure without a clipboard API', async () => {
		stubClipboard();
		render(CopyBtn, { text: 'x' });
		await click();

		expect(btn().classList.contains('failed')).toBe(true);
		expect(live()).toBe('Couldn’t copy');
	});

	it('names the small button after its label', () => {
		render(CopyBtn, { text: 'x', small: true, label: 'Copy link' });

		expect(btn().getAttribute('aria-label')).toBe('Copy link');
	});

	it('goes back to idle after the timeout', async () => {
		stubClipboard(vi.fn().mockResolvedValue(undefined));
		render(CopyBtn, { text: 'x', small: true });
		await click();
		await vi.advanceTimersByTimeAsync(1300);

		expect(btn().classList.contains('done')).toBe(false);
		expect(live()).toBe('');
	});
});
