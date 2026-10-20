import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import Seg from './Seg.svelte';

afterEach(() => cleanup());

const options = [
	{ v: 'a', l: 'Alpha' },
	{ v: 'b', l: 'Beta' },
	{ v: 'c', l: 'Gamma' }
];

describe('Seg', () => {
	it('is a named radio group with one checked, tabbable option', () => {
		render(Seg, { props: { value: 'b', options, label: 'Letters', onChange: vi.fn() } });
		screen.getByRole('radiogroup', { name: 'Letters' });
		const radios = screen.getAllByRole('radio');
		expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
		expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
	});

	it('moves the selection with arrow, Home and End keys', async () => {
		const onChange = vi.fn();
		render(Seg, { props: { value: 'a', options, label: 'Letters', onChange } });
		const [alpha] = screen.getAllByRole('radio');
		await fireEvent.keyDown(alpha, { key: 'ArrowRight' });
		expect(onChange).toHaveBeenLastCalledWith('b');
		await fireEvent.keyDown(alpha, { key: 'ArrowLeft' });
		expect(onChange).toHaveBeenLastCalledWith('c');
		await fireEvent.keyDown(alpha, { key: 'End' });
		expect(onChange).toHaveBeenLastCalledWith('c');
		await fireEvent.keyDown(alpha, { key: 'Home' });
		expect(onChange).toHaveBeenLastCalledWith('a');
		await fireEvent.keyDown(alpha, { key: 'Tab' });
		expect(onChange).toHaveBeenCalledTimes(4);
	});

	it('takes its name from an external label', () => {
		document.body.insertAdjacentHTML('beforeend', '<span id="ext-lbl">Expiry</span>');
		render(Seg, { props: { value: 'a', options, labelledby: 'ext-lbl', onChange: vi.fn() } });
		screen.getByRole('radiogroup', { name: 'Expiry' });
		document.getElementById('ext-lbl')!.remove();
	});
});
