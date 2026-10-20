import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import RecoveryCeremony from './RecoveryCeremony.svelte';
import { headingJumps, unnamedControls } from '../a11yAssert';
import { m } from '$paraglide/messages.js';

const recovery = vi.hoisted(() => ({
	prepareRecovery: vi.fn(),
	commitRecovery: vi.fn(),
	RecoveryVaultLockedError: class extends Error {}
}));
const saveBlob = vi.hoisted(() => vi.fn());

vi.mock('$platform', () => ({ platform: { saveBlob } }));
vi.mock('$core/recovery/setup', () => recovery);
vi.mock('$core/recovery/kit', () => ({ RECOVERY_KIT_FILENAME: 'kit.txt', recoveryKitBlob: () => new Blob() }));
vi.mock('$core/auth/reauth.svelte', () => ({ isReauthenticationRequired: () => false }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'me', email: 'me@thelemail.test', recoveryEnabled: false, loadProfile: vi.fn() }
}));

const phrase = 'one two three four five six seven eight nine ten eleven twelve'.split(' ');

async function toPhraseStep() {
	recovery.prepareRecovery.mockResolvedValue({ phrase });
	const onClose = vi.fn();
	render(RecoveryCeremony, { props: { onClose, onComplete: vi.fn() } });
	await fireEvent.click(screen.getByRole('checkbox'));
	await fireEvent.click(screen.getByRole('button', { name: /Generate my phrase/ }));
	await vi.waitFor(() => expect(screen.getByRole('button', { name: /Reveal phrase/ })).toBeTruthy());
	return onClose;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('RecoveryCeremony close', () => {
	it('closes freely before the phrase is revealed', async () => {
		const onClose = await toPhraseStep();
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('asks before closing once the phrase is shown and unsaved', async () => {
		const onClose = await toPhraseStep();
		await fireEvent.click(screen.getByRole('button', { name: /Reveal phrase/ }));
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).not.toHaveBeenCalled();
		expect(screen.getByText('This recovery phrase won’t be shown again. If you close now, it isn’t saved and you’ll have to start over.')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Keep open' }));
		await fireEvent.click(screen.getByRole('button', { name: /Download recovery file/ }));
		await vi.waitFor(() => expect(saveBlob).toHaveBeenCalled());
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('is a named dialog with named controls and one current step through the word quiz', async () => {
		await toPhraseStep();
		const dialog = screen.getByRole('dialog', { name: m.settings_ceremony_recovery_title() });
		const check = () => {
			expect(unnamedControls(dialog)).toEqual([]);
			expect(headingJumps(dialog, 1)).toEqual([]);
			expect(dialog.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
		};

		check();
		await fireEvent.click(screen.getByRole('button', { name: /Reveal phrase/ }));
		await fireEvent.click(screen.getByRole('button', { name: m.settings_ceremony_recovery_written_down() }));
		expect(dialog.querySelectorAll('.quiz-row input').length).toBeGreaterThan(0);
		check();
	});
});
