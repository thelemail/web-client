import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import RecipientField from './RecipientField.svelte';
import type { RecipientChip } from './data';

vi.mock('$core/stores/personAvatars.svelte', () => ({
	personAvatars: { avatarUrl: () => null }
}));

const chip = (email: string): RecipientChip => ({
	name: email,
	email,
	init: email[0].toUpperCase(),
	bg: '#000',
	fg: '#fff',
	valid: true
});

describe('RecipientField', () => {
	afterEach(cleanup);

	it('keeps an accessible name on the input after the first recipient is added', () => {
		const { getByRole } = render(RecipientField, {
			props: { label: 'To', chips: [chip('ada@example.com')], setChips: vi.fn(), contacts: [] }
		});
		expect(getByRole('combobox', { name: 'To' })).toBeTruthy();
	});

	it('says in text when a recipient will get the message unencrypted', () => {
		const { getByText } = render(RecipientField, {
			props: {
				label: 'To',
				chips: [chip('ada@example.com')],
				setChips: vi.fn(),
				contacts: [],
				encStatusFor: () => 'cleartext' as const
			}
		});
		expect(getByText('No encryption key — sent unencrypted').classList.contains('sr-only')).toBe(true);
	});

	it('exposes suggestions as a listbox driven from the input', async () => {
		const { getByRole } = render(RecipientField, {
			props: {
				label: 'To',
				chips: [],
				setChips: vi.fn(),
				contacts: [chip('ada@example.com'), chip('alan@example.com')]
			}
		});
		const input = getByRole('combobox', { name: 'To' }) as HTMLInputElement;
		await fireEvent.focus(input);
		await fireEvent.input(input, { target: { value: 'a' } });
		const list = getByRole('listbox');
		expect(input.getAttribute('aria-expanded')).toBe('true');
		expect(input.getAttribute('aria-controls')).toBe(list.id);
		const active = document.getElementById(input.getAttribute('aria-activedescendant')!);
		expect(active?.getAttribute('role')).toBe('option');
		expect(active?.getAttribute('aria-selected')).toBe('true');
	});
});
