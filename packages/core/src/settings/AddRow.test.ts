import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import AddRow from './AddRow.svelte';

afterEach(() => cleanup());

describe('AddRow', () => {
	it('is a named button that calls back on click', async () => {
		const onClick = vi.fn();
		render(AddRow, { props: { label: 'Block a sender', onClick } });
		const btn = screen.getByRole('button', { name: 'Block a sender' });
		expect(btn.getAttribute('type')).toBe('button');
		expect(btn.classList.contains('addrow')).toBe(true);
		await fireEvent.click(btn);
		expect(onClick).toHaveBeenCalledOnce();
	});
});
