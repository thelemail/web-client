import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import ProgressRun from './ProgressRun.svelte';

afterEach(() => cleanup());

const lines = ['One', 'Two', 'Three', 'Four'];

function state(container: HTMLElement) {
	return [...container.querySelectorAll('.cp-lines li')].map((li) =>
		li.classList.contains('done') ? 'done' : li.classList.contains('active') ? 'active' : 'pending'
	);
}

describe('ProgressRun', () => {
	it('marks lines from the progress it is given', () => {
		const { container } = render(ProgressRun, { props: { label: 'Working', lines, progress: 2 } });
		expect(state(container)).toEqual(['done', 'done', 'active', 'pending']);
		expect((container.querySelector('.cp-bar i') as HTMLElement).style.width).toBe('50%');
	});

	it('follows progress as the caller advances it', async () => {
		const { container, rerender } = render(ProgressRun, { props: { label: 'Working', lines, progress: 0 } });
		expect(state(container)).toEqual(['active', 'pending', 'pending', 'pending']);
		await rerender({ label: 'Working', lines, progress: 4 });
		expect(state(container)).toEqual(['done', 'done', 'done', 'done']);
		expect((container.querySelector('.cp-bar i') as HTMLElement).style.width).toBe('100%');
	});

	it('clamps progress outside the range of lines', () => {
		const { container } = render(ProgressRun, { props: { label: 'Working', lines, progress: 9 } });
		expect(state(container)).toEqual(['done', 'done', 'done', 'done']);
		const under = render(ProgressRun, { props: { label: 'Working', lines, progress: -3 } });
		expect((under.container.querySelector('.cp-bar i') as HTMLElement).style.width).toBe('0%');
	});
});
