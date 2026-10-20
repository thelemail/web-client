import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Globe from '@lucide/svelte/icons/globe';
import Card from './Card.svelte';

afterEach(() => cleanup());

const children = createRawSnippet(() => ({ render: () => '<p class="body">content</p>' }));
const right = createRawSnippet(() => ({ render: () => '<span class="card-meta">3</span>' }));

describe('Card', () => {
	it('renders a bare card with no header', () => {
		const { container } = render(Card, { props: { children } });
		const card = container.querySelector('.scard')!;
		expect(card.tagName).toBe('DIV');
		expect(card.querySelector('.scard-h')).toBeNull();
		expect(card.querySelector('.body')).not.toBeNull();
	});

	it('renders the icon, title and right side in the header', () => {
		const { container } = render(Card, { props: { title: 'Domains', icon: Globe, right, children } });
		const head = container.querySelector('.scard > .scard-h')!;
		expect(head.querySelector('svg')).not.toBeNull();
		expect(head.querySelector('h3')!.textContent).toBe('Domains');
		expect(head.lastElementChild!.classList.contains('card-meta')).toBe(true);
	});

	it.each(['flat', 'menus', 'danger'] as const)('applies the %s variant', (variant) => {
		const { container } = render(Card, { props: { variant, children } });
		expect(container.querySelector('.scard')!.classList.contains(variant)).toBe(true);
	});

	it('carries the styling hooks used by plan and address cards', () => {
		const { container } = render(Card, {
			props: {
				as: 'section',
				class: 'addr-group',
				headClass: 'addr-group-h',
				titleClass: 'addr-domain',
				title: 'example.com',
				'data-type': 'family',
				children
			}
		});
		const card = container.querySelector('section.scard.addr-group')!;
		expect(card.getAttribute('data-type')).toBe('family');
		expect(card.querySelector('.scard-h.addr-group-h h3.addr-domain')!.textContent).toBe('example.com');
	});
});
