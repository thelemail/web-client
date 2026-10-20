import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import Row from './Row.svelte';

afterEach(() => cleanup());

describe('Row', () => {
	it('renders the description as text, never as markup', () => {
		const { container } = render(Row, { props: { t: 'Title', d: '<b>bold</b> <img src=x onerror=alert(1)>' } });
		const d = container.querySelector('.d')!;
		expect(d.textContent).toBe('<b>bold</b> <img src=x onerror=alert(1)>');
		expect(d.querySelector('b')).toBeNull();
		expect(d.querySelector('img')).toBeNull();
	});

	it('leaves the description out when none is given', () => {
		const { container } = render(Row, { props: { t: 'Title' } });
		expect(container.querySelector('.t')!.textContent).toBe('Title');
		expect(container.querySelector('.d')).toBeNull();
	});
});
