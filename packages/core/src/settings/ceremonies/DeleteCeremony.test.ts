import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import DeleteCeremony from './DeleteCeremony.svelte';
import { headingJumps, unnamedControls } from '../a11yAssert';
import { m } from '$paraglide/messages.js';
import { ApiCallError } from '$core/api/types';
import { initDeletion } from '$core/api/deletion';

vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$core/api/deletion', () => ({
	confirmDeletion: vi.fn(),
	confirmDeletionOpaque: vi.fn(),
	initDeletion: vi.fn(),
	initDeletionOpaque: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribeAccount: () => () => {},
		status: vi.fn(async () => ({ accounts: [{ accountId: 'me', authScheme: 'srp_v1' }] }))
	}
}));
vi.mock('$core/auth/webauthn', () => ({ webauthnSupported: () => false, webauthnFailure: () => null, webauthnFailureMessage: () => '' }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: { list: [] } }));
vi.mock('$core/stores/twofactor.svelte', () => ({ twofactor: { status: null, phase: 'ready', ensure: vi.fn() } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'me', email: 'ada@thelemail.com' } }));

const ws = vi.hoisted(() => ({
	workspace: { id: 'w1', ownerAccountId: 'me' } as { id: string; ownerAccountId: string } | null,
	members: [] as { accountId: string }[],
	isOwner(id: string | null) {
		return !!this.workspace && this.workspace.ownerAccountId === id;
	},
	load: vi.fn()
}));
vi.mock('$core/stores/workspaces.svelte', () => ({ workspaces: ws }));

beforeEach(() => {
	ws.workspace = { id: 'w1', ownerAccountId: 'me' };
	ws.members = [{ accountId: 'me' }];
});

afterEach(cleanup);

function continueButton(): HTMLButtonElement {
	return screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
}

describe('DeleteCeremony', () => {
	it('links the export step to the Export Tool', () => {
		render(DeleteCeremony, { props: { onClose: vi.fn(), onComplete: vi.fn() } });
		const link = screen.getByRole('link', { name: /Get the Export Tool/ });
		expect(link.getAttribute('href')).toBe('https://github.com/thelemail/export-tool');
		expect(link.getAttribute('target')).toBe('_blank');
	});

	it('keeps Continue disabled until both acknowledgements are ticked and the address is typed', async () => {
		render(DeleteCeremony, { props: { onClose: vi.fn(), onComplete: vi.fn() } });
		await fireEvent.click(continueButton());

		const [destroyed, exported] = screen.getAllByRole('checkbox');
		const field = document.querySelector<HTMLInputElement>('#del-confirm')!;
		expect(continueButton().disabled).toBe(true);

		await fireEvent.click(destroyed);
		await fireEvent.input(field, { target: { value: 'ada@thelemail.com' } });
		expect(continueButton().disabled).toBe(true);

		await fireEvent.click(exported);
		await fireEvent.input(field, { target: { value: 'ada@thelemail.co' } });
		expect(continueButton().disabled).toBe(true);

		await fireEvent.input(field, { target: { value: 'ada@thelemail.com' } });
		expect(continueButton().disabled).toBe(false);

		await fireEvent.click(destroyed);
		expect(continueButton().disabled).toBe(true);
	});

	it('is a named dialog with named controls and one current step on each step', async () => {
		render(DeleteCeremony, { props: { onClose: vi.fn(), onComplete: vi.fn() } });
		const dialog = screen.getByRole('dialog', { name: m.settings_ceremony_delete_title() });
		const check = () => {
			expect(unnamedControls(dialog)).toEqual([]);
			expect(headingJumps(dialog, 1)).toEqual([]);
			expect(dialog.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
		};

		check();
		await fireEvent.click(continueButton());
		check();
	});

	it('describes sign-out as a consequence on the first step', () => {
		render(DeleteCeremony, { props: { onClose: vi.fn(), onComplete: vi.fn() } });
		const text = document.body.textContent ?? '';
		expect(text).toContain('When you confirm, you are signed out everywhere.');
		expect(text).not.toMatch(/signed out everywhere now|been signed out/i);
	});

	it('stops a workspace owner with other members on the first step', async () => {
		ws.members = [{ accountId: 'me' }, { accountId: 'kid' }];
		const onClose = vi.fn();
		render(DeleteCeremony, { props: { onClose, onComplete: vi.fn() } });

		expect(document.body.textContent).toContain(m.settings_ceremony_delete_workspace_lede());
		expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
		expect(document.querySelector('#del-confirm')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Manage members' }));
		expect(onClose).toHaveBeenCalled();
	});

	it.each([
		['a sole owner', { id: 'w1', ownerAccountId: 'me' }, [{ accountId: 'me' }]],
		['a member of a shared workspace', { id: 'w1', ownerAccountId: 'parent' }, [{ accountId: 'parent' }, { accountId: 'me' }]],
		['an account whose workspace has not loaded', null, []]
	])('lets %s continue to the confirm step', async (_, workspace, members) => {
		ws.workspace = workspace;
		ws.members = members;
		render(DeleteCeremony, { props: { onClose: vi.fn(), onComplete: vi.fn() } });
		await fireEvent.click(continueButton());
		expect(document.querySelector('#del-confirm')).not.toBeNull();
	});

	it('still shows the block when the server refuses a stale client', async () => {
		vi.mocked(initDeletion).mockRejectedValue(
			new ApiCallError(409, { error: { code: 'workspace_transfer_required', message: '' } }, 'HTTP 409')
		);
		render(DeleteCeremony, { props: { onClose: vi.fn(), onComplete: vi.fn() } });
		await fireEvent.click(continueButton());
		for (const box of screen.getAllByRole('checkbox')) await fireEvent.click(box);
		await fireEvent.input(document.querySelector('#del-confirm')!, { target: { value: 'ada@thelemail.com' } });
		await fireEvent.click(continueButton());
		await fireEvent.input(document.querySelector('#del-pw')!, { target: { value: 'pw' } });
		await fireEvent.click(screen.getByRole('button', { name: /Delete/ }));

		await vi.waitFor(() =>
			expect(document.body.textContent).toContain(m.settings_ceremony_delete_workspace_lede())
		);
		expect(screen.getByRole('button', { name: 'Manage members' })).toBeTruthy();
	});
});
