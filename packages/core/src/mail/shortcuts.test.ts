import { afterEach, describe, expect, it } from 'vitest';
import { isListShortcut } from './shortcuts';

function keyFrom(el: Element, key: string, handled = false): KeyboardEvent {
	let seen: KeyboardEvent | null = null;
	const listen = (e: Event) => (seen = e as KeyboardEvent);
	document.addEventListener('keydown', listen);
	if (handled) el.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	document.removeEventListener('keydown', listen);
	return seen!;
}

describe('message list shortcuts', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('leave keys alone that the sidebar tree, its menus and dialogs use', () => {
		document.body.innerHTML = `
			<nav><a id="sys" href="#">Inbox</a></nav>
			<ul role="tree"><li role="none"><a id="item" role="treeitem" href="#">Clients</a></li></ul>
			<div role="menu"><div id="mi" role="menuitem">Add to favorites</div></div>
			<div role="dialog"><button id="dlg">Create</button></div>
			<div id="body"></div>`;
		for (const id of ['sys', 'item', 'mi', 'dlg']) {
			expect(isListShortcut(keyFrom(document.getElementById(id)!, 'ArrowDown'))).toBe(false);
		}
		expect(isListShortcut(keyFrom(document.getElementById('body')!, 'ArrowDown'))).toBe(true);
	});

	it('skip a key another handler already used', () => {
		document.body.innerHTML = '<div id="x"></div>';
		expect(isListShortcut(keyFrom(document.getElementById('x')!, 'Enter', true))).toBe(false);
	});
});
