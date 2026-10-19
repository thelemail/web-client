import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Workspace, WorkspaceMember } from '$core/api/workspaces';
import { platformDomains } from '$core/stores/platformDomains.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import FamilyInviteCeremony from './FamilyInviteCeremony.svelte';

vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'me', email: 'ada@temail.org' } }));
vi.mock('$core/api/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/auth')>()),
	getPlatformDomains: vi.fn().mockResolvedValue({
		domains: ['temail.org'],
		hosted: ['temail.org', 'thelemail.com'],
		default: 'temail.org'
	})
}));

const at = '2026-09-21T12:00:00Z';

beforeAll(() => platformDomains.load());

beforeEach(() => {
	workspaces.workspace = { id: 'w1', ownerAccountId: 'me', name: 'Lovelace', type: 'family', createdAt: at, updatedAt: at } as Workspace;
	workspaces.members = [{ accountId: 'me', email: 'ada@temail.org' } as WorkspaceMember];
	workspaces.invites = [];
});

afterEach(() => {
	cleanup();
	workspaces.workspace = null;
	workspaces.members = [];
	workspaces.invites = [];
});

function open() {
	return render(FamilyInviteCeremony, { props: { onClose: () => {}, onComplete: () => {} } });
}

function sendButton(): HTMLButtonElement | undefined {
	return [...document.querySelectorAll('button')].find((b) =>
		b.textContent?.includes('Send invitation')
	);
}

async function enter(email: string) {
	await fireEvent.input(document.querySelector<HTMLInputElement>('#fam-inv-email')!, {
		target: { value: email }
	});
}

describe('FamilyInviteCeremony', () => {
	it('accepts an invitee on a hosted domain that is no longer offered', async () => {
		open();
		await enter('jules@thelemail.com');
		expect(document.querySelector('.field-hint.bad')).toBeNull();
		expect(document.querySelector('.field-hint')?.textContent).toContain('thelemail.com');
		expect(sendButton()?.disabled).toBe(false);
	});

	it('refuses an invitee off the platform and names every hosted domain', async () => {
		open();
		await enter('jules@example.com');
		const problem = document.querySelector('.field-hint.bad')?.textContent ?? '';
		expect(problem).toContain('temail.org');
		expect(problem).toContain('thelemail.com');
		expect(sendButton()?.disabled).toBe(true);
	});
});
