import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import KeyRound from '@lucide/svelte/icons/key-round';
import CeremonyShell from './CeremonyShell.svelte';
import { m } from '$paraglide/messages.js';

afterEach(() => cleanup());

const children = createRawSnippet(() => ({ render: () => '<p>body</p>' }));

describe('CeremonyShell', () => {
	it('is named by its visible title heading', () => {
		render(CeremonyShell, {
			props: { icon: KeyRound, eyebrow: 'Security', title: 'Change password', onClose: vi.fn(), children }
		});
		const dialog = screen.getByRole('dialog', { name: 'Change password' });
		const heading = within(dialog).getByRole('heading', { level: 2, name: 'Change password' });
		expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
	});

	it('marks the current step and announces completed ones', () => {
		render(CeremonyShell, {
			props: {
				icon: KeyRound,
				eyebrow: 'Security',
				title: 'Two-step',
				steps: ['Method', 'Verify', 'Done'],
				step: 1,
				onClose: vi.fn(),
				children
			}
		});
		const items = within(screen.getByRole('list')).getAllByRole('listitem');
		expect(items.map((li) => li.getAttribute('aria-current'))).toEqual([null, 'step', null]);
		expect(items[0].textContent).toContain(m.settings_step_completed());
		expect(items[1].textContent).not.toContain(m.settings_step_completed());
	});
});
