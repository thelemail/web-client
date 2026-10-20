import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import RecordRow from './RecordRow.svelte';

afterEach(() => cleanup());

const badges = createRawSnippet(() => ({ render: () => '<span class="badge">Active</span>' }));
const actions = createRawSnippet(() => ({ render: () => '<div class="rec-actions">act</div>' }));
const children = createRawSnippet(() => ({ render: () => '<div class="rec-meta">meta</div>' }));

describe('RecordRow', () => {
	it('lays out label, badges, body and actions', () => {
		const { container } = render(RecordRow, { props: { label: 'Laptop', top: true, badges, actions, children } });
		const row = container.querySelector('.rec-row.top')!;
		const title = row.querySelector('.rec-main > .rec-title')!;
		expect(title.querySelector('.rec-label')!.textContent).toBe('Laptop');
		expect(title.querySelector('.badge')).not.toBeNull();
		expect(row.querySelector('.rec-main > .rec-meta')).not.toBeNull();
		expect(row.lastElementChild!.classList.contains('rec-actions')).toBe(true);
	});

	it('renders just the label when nothing else is given', () => {
		const { container } = render(RecordRow, { props: { label: 'Phone' } });
		const row = container.querySelector('.rec-row')!;
		expect(row.classList.contains('top')).toBe(false);
		expect(row.children).toHaveLength(1);
	});
});
