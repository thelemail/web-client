import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import RemoveMemberDialog from './RemoveMemberDialog.svelte';
import LeaveFamilyDialog from './LeaveFamilyDialog.svelte';
import FamilyStartCeremony from './ceremonies/FamilyStartCeremony.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import { ApiCallError } from '$core/api/types';

vi.mock('$platform', () => ({ platform: { returnOrigin: () => 'https://mail.test' } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'me', fullName: 'Ada Lovelace' } }));
vi.mock('$core/stores/accountData', () => ({ reloadWorkspaceData: vi.fn() }));
vi.mock('$core/auth/reauth.svelte', () => ({ isReauthenticationRequired: () => false }));

const raw = 'pq: duplicate key value violates unique constraint';

function serverError(code: string, status = 409) {
	return new ApiCallError(status, { error: { code, message: raw } } as never, raw);
}

function footerAction(): HTMLButtonElement {
	const buttons = document.querySelectorAll<HTMLButtonElement>('.cer-foot button');
	return buttons[buttons.length - 1];
}

async function submitAndReadAlert(): Promise<string> {
	await fireEvent.click(footerAction());
	let text = '';
	await vi.waitFor(() => {
		text = document.querySelector('[role="alert"]')?.textContent ?? '';
		expect(text).not.toBe('');
	});
	expect(document.body.textContent).not.toContain(raw);
	return text;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('family dialogs never show raw server text', () => {
	it('remove member', async () => {
		vi.spyOn(workspaces, 'removeMember').mockRejectedValue(serverError('internal_error', 500));
		render(RemoveMemberDialog, { props: { name: 'Bo Ng', email: 'bo@temail.org', accountId: 'm1', onClose: vi.fn() } });
		expect(await submitAndReadAlert()).toContain('Could not remove this person');
	});

	it('leave family', async () => {
		vi.spyOn(workspaces, 'leave').mockRejectedValue(serverError('forbidden', 403));
		render(LeaveFamilyDialog, { props: { familyName: 'Home', onClose: vi.fn() } });
		expect(await submitAndReadAlert()).toContain('You don’t have permission to do that in this workspace.');
	});

	it('start a family', async () => {
		vi.spyOn(workspaces, 'changeType').mockRejectedValue(serverError('conflict'));
		render(FamilyStartCeremony, { props: { onClose: vi.fn(), onComplete: vi.fn() } });
		expect(await submitAndReadAlert()).toContain('Something changed in the meantime.');
	});

	it('falls back to translated copy for a network failure', async () => {
		vi.spyOn(workspaces, 'removeMember').mockRejectedValue(new TypeError('Failed to fetch'));
		render(RemoveMemberDialog, { props: { name: 'Bo Ng', email: 'bo@temail.org', accountId: 'm1', onClose: vi.fn() } });
		await fireEvent.click(footerAction());
		await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not remove this person'));
		expect(document.body.textContent).not.toContain('Failed to fetch');
	});
});
