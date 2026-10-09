import type { Action } from 'svelte/action';

export interface TrapFocusOptions {
	onEscape?: () => void;
}

const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[contenteditable="true"]',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const stack: HTMLElement[] = [];
const recent: HTMLElement[] = [];

if (typeof document !== 'undefined') {
	document.addEventListener(
		'focusin',
		(e) => {
			if (!(e.target instanceof HTMLElement)) return;
			recent.push(e.target);
			if (recent.length > 8) recent.shift();
		},
		true
	);
}

function openerFor(node: HTMLElement): HTMLElement | null {
	const active = document.activeElement;
	if (active instanceof HTMLElement && active !== document.body && !node.contains(active)) return active;
	for (let i = recent.length - 1; i >= 0; i--) {
		const el = recent[i];
		if (el.isConnected && !node.contains(el)) return el;
	}
	return null;
}

function focusables(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(el) => el.getClientRects().length > 0 && !el.closest('[inert]')
	);
}

function initialTarget(root: HTMLElement): HTMLElement {
	const marked = root.querySelector<HTMLElement>('[data-autofocus]');
	if (marked) return marked;
	const list = focusables(root);
	const field = list.find((el) => el.matches('input, select, textarea, [contenteditable="true"]'));
	return field ?? list[0] ?? root;
}

export const trapFocus: Action<HTMLElement, TrapFocusOptions | undefined> = (node, options) => {
	let opts = options ?? {};
	const previous = openerFor(node);
	if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
	stack.push(node);

	queueMicrotask(() => {
		if (!node.isConnected || node.contains(document.activeElement)) return;
		initialTarget(node).focus({ preventScroll: true });
	});

	function onKey(e: KeyboardEvent) {
		if (stack[stack.length - 1] !== node) return;
		if (e.key === 'Escape' && opts.onEscape) {
			e.preventDefault();
			e.stopPropagation();
			opts.onEscape();
			return;
		}
		if (e.key !== 'Tab') return;
		const list = focusables(node);
		if (list.length === 0) {
			e.preventDefault();
			node.focus();
			return;
		}
		const first = list[0];
		const last = list[list.length - 1];
		const active = document.activeElement;
		const inside = node.contains(active);
		if (!inside && active instanceof Element && active.closest(LAYER)) return;
		if (e.shiftKey && (!inside || active === first || active === node)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (!inside || active === last)) {
			e.preventDefault();
			first.focus();
		}
	}

	document.addEventListener('keydown', onKey, true);

	return {
		update(next) {
			opts = next ?? {};
		},
		destroy() {
			document.removeEventListener('keydown', onKey, true);
			const i = stack.lastIndexOf(node);
			if (i >= 0) stack.splice(i, 1);
			const lost = !document.activeElement || document.activeElement === document.body || node.contains(document.activeElement);
			if (lost && previous?.isConnected) previous.focus({ preventScroll: true });
		}
	};
};
