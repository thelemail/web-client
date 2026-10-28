import { afterEach, describe, expect, it } from 'vitest';
import { canTakeFocus } from './readerFocus';

afterEach(() => {
	document.body.innerHTML = '';
});

function place(html: string): HTMLElement {
	document.body.innerHTML = html;
	return document.body.querySelector<HTMLElement>('[data-at]')!;
}

describe('canTakeFocus', () => {
	it('takes focus from nothing, the page or a list row', () => {
		expect(canTakeFocus(null)).toBe(true);
		expect(canTakeFocus(document.body)).toBe(true);
		expect(canTakeFocus(place('<button data-at class="mrow-open"></button>'))).toBe(true);
	});

	it('leaves typing alone', () => {
		expect(canTakeFocus(place('<input data-at>'))).toBe(false);
		expect(canTakeFocus(place('<textarea data-at></textarea>'))).toBe(false);
		expect(canTakeFocus(place('<select data-at></select>'))).toBe(false);
		const editor = place('<div data-at contenteditable="true"></div>');
		Object.defineProperty(editor, 'isContentEditable', { value: true });
		expect(canTakeFocus(editor)).toBe(false);
	});

	it('leaves open dialogs and menus alone', () => {
		expect(canTakeFocus(place('<div role="dialog"><button data-at></button></div>'))).toBe(false);
		expect(canTakeFocus(place('<div role="menu"><button data-at></button></div>'))).toBe(false);
	});
});
