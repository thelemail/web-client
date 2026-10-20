import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import DeleteCeremony from './DeleteCeremony.svelte';

vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$core/api/deletion', () => ({
	confirmDeletion: vi.fn(),
	confirmDeletionOpaque: vi.fn(),
	initDeletion: vi.fn(),
	initDeletionOpaque: vi.fn()
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribeAccount: () => () => {} } }));
vi.mock('$core/auth/webauthn', () => ({ webauthnSupported: () => false, isWebauthnCancelled: () => false }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: { list: [] } }));
vi.mock('$core/stores/twofactor.svelte', () => ({ twofactor: { status: null, phase: 'ready', ensure: vi.fn() } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'me', email: 'ada@thelemail.com' } }));

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
});
