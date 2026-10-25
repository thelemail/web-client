import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import ImportKeyDialog from './ImportKeyDialog.svelte';
import { headingJumps, unnamedControls } from './a11yAssert';
import { m } from '$paraglide/messages.js';

const api = vi.hoisted(() => ({ importExternalKey: vi.fn() }));
const armor = vi.hoisted(() => ({ inspectArmoredKey: vi.fn() }));

vi.mock('$core/api/externalKeys', () => api);
vi.mock('$core/mail/senderVerify', () => ({ forgetSenderTrust: vi.fn() }));
vi.mock('$core/auth/reauth.svelte', () => ({ isReauthenticationRequired: () => false }));
vi.mock('$core/directory/armor', () => armor);

const FP = '2f1ee47e2e754f6ef9a9b0ce3779c6bf6eb12be8';
const ARMOR = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nxjMEZ\n-----END PGP PUBLIC KEY BLOCK-----';

function button(label: string) {
	return screen.getByRole('button', { name: label }) as HTMLButtonElement;
}

async function fill(address: string) {
	render(ImportKeyDialog, { props: { onClose: vi.fn() } });
	await fireEvent.input(screen.getByLabelText('Contact’s address'), { target: { value: address } });
	await fireEvent.input(screen.getByLabelText('Public key'), { target: { value: ARMOR } });
	await fireEvent.click(button('Review key'));
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('ImportKeyDialog', () => {
	it('shows the fingerprint and identities and sends nothing until the key is pinned', async () => {
		armor.inspectArmoredKey.mockResolvedValue({ fingerprintHex: FP, userIds: ['Ada <ada@example.org>'] });
		api.importExternalKey.mockResolvedValue({ address: 'ada@example.org', fingerprint: 'Lx7kfi51T2/5qbDON3nGv26xK+g=' });
		await fill('Ada@Example.org');

		await vi.waitFor(() => expect(screen.getByText('Ada <ada@example.org>')).toBeTruthy());
		expect(document.body.textContent).toContain('2F1E E47E 2E75 4F6E F9A9');
		expect(screen.queryByRole('alert')).toBeNull();
		expect(api.importExternalKey).not.toHaveBeenCalled();

		await fireEvent.click(button('Pin key'));
		await vi.waitFor(() => expect(api.importExternalKey).toHaveBeenCalledWith('ada@example.org', ARMOR));
		await vi.waitFor(() => expect(document.body.textContent).toContain('is now pinned'));
	});

	it('flags identities that do not match the entered address', async () => {
		armor.inspectArmoredKey.mockResolvedValue({ fingerprintHex: FP, userIds: ['Eve <eve@example.org>'] });
		await fill('ada@example.org');

		await vi.waitFor(() =>
			expect(screen.getByRole('alert').textContent).toContain('None of these identities is ada@example.org')
		);
		expect(api.importExternalKey).not.toHaveBeenCalled();

		await fireEvent.click(button('Back'));
		expect((screen.getByLabelText('Public key') as HTMLTextAreaElement).value).toBe(ARMOR);
	});

	it('refuses malformed armor without contacting the server', async () => {
		armor.inspectArmoredKey.mockResolvedValue(null);
		await fill('ada@example.org');

		await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('isn’t a readable public key'));
		expect(screen.queryByRole('button', { name: 'Pin key' })).toBeNull();
		expect(api.importExternalKey).not.toHaveBeenCalled();
	});

	it('is a named dialog with named controls on the entry and review steps', async () => {
		armor.inspectArmoredKey.mockResolvedValue({ fingerprintHex: FP, userIds: ['Ada <ada@example.org>'] });
		render(ImportKeyDialog, { props: { onClose: vi.fn() } });
		const dialog = screen.getByRole('dialog', { name: m.settings_import_key_title() });

		expect(unnamedControls(dialog)).toEqual([]);
		expect(headingJumps(dialog, 1)).toEqual([]);

		await fireEvent.input(screen.getByLabelText('Contact’s address'), { target: { value: 'ada@example.org' } });
		await fireEvent.input(screen.getByLabelText('Public key'), { target: { value: ARMOR } });
		await fireEvent.click(button('Review key'));
		await vi.waitFor(() => expect(screen.getByText('Ada <ada@example.org>')).toBeTruthy());

		expect(unnamedControls(dialog)).toEqual([]);
		expect(headingJumps(dialog, 1)).toEqual([]);
	});
});
