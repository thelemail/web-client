import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import TwoFactorBackupCodesDialog from './TwoFactorBackupCodesDialog.svelte';

const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('$platform', () => ({ platform: { saveBlob } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { email: 'me@thelemail.test' } }));

const codes = ['aaaa-bbbb', 'cccc-dddd'];

function show() {
	const onClose = vi.fn();
	render(TwoFactorBackupCodesDialog, { props: { codes, onClose } });
	return onClose;
}

function writeText(impl: () => Promise<void>) {
	Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(impl) }, configurable: true });
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('TwoFactorBackupCodesDialog', () => {
	it('asks before closing while the codes are unsaved', async () => {
		const onClose = show();
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByText('Close without saving?')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Keep open' }));
		expect(screen.queryByText('Close without saving?')).toBeNull();
		expect(document.body.textContent).toContain('aaaa-bbbb');

		await fireEvent.mouseDown(document.querySelector('.cer-scrim')!);
		await fireEvent.click(screen.getByRole('button', { name: 'Close anyway' }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('stays blocked when copying fails', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		writeText(() => Promise.reject(new Error('denied')));
		const onClose = show();
		await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
		await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Couldn’t copy.'));

		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByText('Close without saving?')).toBeTruthy();
	});

	it('closes freely once the codes are copied or downloaded', async () => {
		writeText(() => Promise.resolve());
		const onClose = show();
		await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
		await vi.waitFor(() => expect(screen.getByRole('button', { name: /I’ve saved them/ }).hasAttribute('disabled')).toBe(false));
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);

		cleanup();
		const onClose2 = show();
		await fireEvent.click(screen.getByRole('button', { name: /Download/ }));
		await vi.waitFor(() => expect(saveBlob).toHaveBeenCalled());
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose2).toHaveBeenCalledTimes(1);
	});
});
