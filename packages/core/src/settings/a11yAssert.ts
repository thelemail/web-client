import { within } from '@testing-library/svelte';

const CONTROL_ROLES = ['switch', 'combobox', 'textbox', 'radiogroup', 'radio', 'checkbox', 'spinbutton', 'listbox'];

export function unnamedControls(root: HTMLElement): string[] {
	const scope = within(root);
	const out: string[] = [];
	for (const role of CONTROL_ROLES) {
		const named = new Set(scope.queryAllByRole(role, { name: /\S/ }));
		for (const el of scope.queryAllByRole(role)) {
			if (!named.has(el)) out.push(`${role}: ${el.outerHTML.slice(0, 160)}`);
		}
	}
	return out;
}

export function headingJumps(root: HTMLElement, start: number): string[] {
	const out: string[] = [];
	let prev = start;
	for (const el of within(root).queryAllByRole('heading')) {
		const level = Number(el.tagName.slice(1));
		if (level > prev + 1) out.push(`h${prev} -> h${level} "${el.textContent?.trim()}"`);
		prev = level;
	}
	return out;
}
