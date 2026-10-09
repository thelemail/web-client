import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trapFocus } from './trapFocus';

describe('trapFocus', () => {
	let rects: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		rects = vi
			.spyOn(Element.prototype, 'getClientRects')
			.mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
	});

	afterEach(() => {
		document.body.replaceChildren();
		rects.mockRestore();
	});

	it('returns focus to the opener when a field inside was focused before the trap started', () => {
		const opener = document.createElement('button');
		const dialog = document.createElement('div');
		const field = document.createElement('input');
		dialog.appendChild(field);
		document.body.append(opener, dialog);

		opener.focus();
		field.focus();
		const trap = trapFocus(dialog);
		dialog.remove();
		trap?.destroy?.();

		expect(document.activeElement).toBe(opener);
	});
});
