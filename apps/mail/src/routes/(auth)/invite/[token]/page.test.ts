import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { ApiCallError } from '$core/api/types';
import type { WorkspaceInvitePreview } from '$core/api/workspaces';
import InvitePage from './+page.svelte';

const ws = vi.hoisted(() => ({
	previewWorkspaceInvite: vi.fn(),
	registerAndAcceptInvite: vi.fn()
}));
vi.mock('$core/api/workspaces', () => ws);

const authApi = vi.hoisted(() => ({ registrationInit: vi.fn() }));
vi.mock('$core/api/auth', () => authApi);

const keystore = vi.hoisted(() => ({
	opaqueStartRegistration: vi.fn(),
	opaqueFinishRegistration: vi.fn(),
	opaqueFinalizeRegister: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore }));

vi.mock('$core/auth/registration-proof', () => ({
	createRegistrationProof: () => ({ prepare: vi.fn(), dispose: vi.fn() }),
	withRegistrationProof: (_proof: unknown, run: (payload: undefined) => unknown) => run(undefined)
}));

vi.mock('$core/stores/auth.svelte', () => ({ auth: { setSession: vi.fn(), loadProfile: vi.fn() } }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: { load: vi.fn(), byId: vi.fn(), upsert: vi.fn(), allocateSlot: vi.fn() } }));
vi.mock('$core/stores/accountData', () => ({ reloadWorkspaceData: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({ page: { params: { token: 'tok1' } } }));

const preview: WorkspaceInvitePreview = {
	kind: 'provision',
	workspaceName: 'Acme',
	workspaceType: 'business',
	inviterDisplayName: 'Ada Owner',
	inviteeEmail: 'bob@acme.co.uk',
	role: 'member',
	expiresAt: '2026-09-29T12:00:00Z'
};

function notAcceptable() {
	return new ApiCallError(
		409,
		{ error: { code: 'invite_not_acceptable', message: 'the domain for this invitation is not available' } },
		'the domain for this invitation is not available'
	);
}

function text() {
	return document.body.textContent ?? '';
}

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

beforeEach(() => {
	for (const fn of [...Object.values(ws), ...Object.values(authApi), ...Object.values(keystore)]) fn.mockReset();
});

afterEach(() => {
	cleanup();
});

describe('invite page', () => {
	it('explains an invitation whose domain is no longer available', async () => {
		ws.previewWorkspaceInvite.mockRejectedValue(notAcceptable());
		render(InvitePage);

		await vi.waitFor(() => expect(text()).toContain('This invitation is no longer valid.'));
		expect(text()).not.toContain('the domain for this invitation is not available');
		expect(ws.previewWorkspaceInvite).toHaveBeenCalledWith('tok1');
	});

	it('explains a refusal that arrives while the account is being created', async () => {
		ws.previewWorkspaceInvite.mockResolvedValue(preview);
		authApi.registrationInit.mockResolvedValue({ accountId: 'a2', registrationId: 'r1', registrationResponse: 'resp' });
		keystore.opaqueStartRegistration.mockResolvedValue({ operationId: 'op1', registrationRequest: 'req' });
		keystore.opaqueFinishRegistration.mockResolvedValue({ ok: true, opaqueRecord: 'rec' });
		ws.registerAndAcceptInvite.mockRejectedValue(notAcceptable());
		render(InvitePage);

		await vi.waitFor(() => expect(document.querySelector('#invite-name')).not.toBeNull());
		await fireEvent.input(document.querySelector('#invite-name')!, { target: { value: 'Bob Builder' } });
		await fireEvent.click(button('Continue')!);

		const [pw, confirm] = [...document.querySelectorAll('input[type="password"]')];
		await fireEvent.input(pw, { target: { value: 'Tr1cky-Passw0rd' } });
		await fireEvent.input(confirm, { target: { value: 'Tr1cky-Passw0rd' } });
		await fireEvent.click(document.querySelector('input[type="checkbox"]')!);
		await fireEvent.click(button('Create account')!);

		await vi.waitFor(() =>
			expect(text()).toContain('The invitation may have expired, been revoked, or already been used.')
		);
		expect(ws.registerAndAcceptInvite).toHaveBeenCalledTimes(1);
		expect(text()).not.toContain('the domain for this invitation is not available');
	});
});
