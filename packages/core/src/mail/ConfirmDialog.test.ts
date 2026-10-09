import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import ConfirmDialog from './ConfirmDialog.svelte';

describe('ConfirmDialog focus', () => {
	let rects: ReturnType<typeof vi.spyOn>;
	let opener: HTMLButtonElement;

	beforeEach(() => {
		rects = vi
			.spyOn(Element.prototype, 'getClientRects')
			.mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
		opener = document.createElement('button');
		opener.textContent = 'Open';
		document.body.appendChild(opener);
		opener.focus();
	});

	afterEach(() => {
		cleanup();
		opener.remove();
		rects.mockRestore();
	});

	function open() {
		return render(ConfirmDialog, {
			props: { title: 'Delete label', confirmLabel: 'Delete', onConfirm: vi.fn(), onClose: vi.fn() }
		});
	}

	it('moves focus into the dialog when it opens', async () => {
		const { getByRole } = open();
		const dialog = getByRole('dialog');
		await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
	});

	it('wraps Tab from the last control back to the first', async () => {
		const { getByRole } = open();
		const dialog = getByRole('dialog');
		const buttons = [...dialog.querySelectorAll('button')];
		const first = buttons[0];
		const last = buttons[buttons.length - 1];
		last.focus();
		await fireEvent.keyDown(document, { key: 'Tab' });
		expect(document.activeElement).toBe(first);
		await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(last);
	});

	it('pulls focus back in when it has escaped to the page', async () => {
		const { getByRole } = open();
		const dialog = getByRole('dialog');
		opener.focus();
		await fireEvent.keyDown(document, { key: 'Tab' });
		expect(dialog.contains(document.activeElement)).toBe(true);
	});

	it('returns focus to the opener when it closes', async () => {
		const { getByRole, unmount } = open();
		const dialog = getByRole('dialog');
		await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
		unmount();
		expect(document.activeElement).toBe(opener);
	});
});
