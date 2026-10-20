import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import CeremonyShell from './CeremonyShell.svelte';
import SecretLeaveConfirm from './SecretLeaveConfirm.svelte';
import { m } from '$paraglide/messages.js';
import './settings.css';

function hitTarget(el: HTMLElement): Element | null {
	const box = el.getBoundingClientRect();
	return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
}

describe('SecretLeaveConfirm over a ceremony', () => {
	afterEach(cleanup);

	it('sits above the ceremony panel so both choices can be clicked', () => {
		render(CeremonyShell, {
			icon: ShieldCheck,
			eyebrow: 'Security',
			title: 'Add security key',
			onClose: vi.fn(),
			children: createRawSnippet(() => ({ render: () => '<p>codes</p>' }))
		});
		render(SecretLeaveConfirm, { desc: 'Codes are shown once.', onStay: vi.fn(), onLeave: vi.fn() });

		for (const name of [m.settings_secret_leave_stay(), m.settings_secret_leave_confirm()]) {
			const button = screen.getByRole('button', { name });
			expect(button.contains(hitTarget(button))).toBe(true);
		}
	});
});
