import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { userEvent } from 'vitest/browser';
import ReplyBox from './ReplyBox.svelte';
import type { Message } from './data';


vi.mock('$app/env/public', () => ({
	PUBLIC_API_BASE_URL: 'https://api.test.thelemail.local',
	PUBLIC_SUBMISSION_BASE_URL: 'https://submit.test.thelemail.local',
	PUBLIC_OFFICIAL_SENDER_POLICY: undefined,
	PUBLIC_TLOG_POLICY: undefined,
	PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: undefined,
	PUBLIC_LAUNCHED_PRODUCTS: undefined,
	PUBLIC_PRODUCT_ORIGINS: undefined,
	PUBLIC_THELEMAIL_PRODUCT: undefined
}));
vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test' }));
vi.mock('$core/directory/signing-key', () => ({
	DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: '',
	DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: ''
}));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: { subscribe: () => () => {} }
}));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: null, email: 'me@thelemail.com', fullName: 'Me Tester', avatarUrl: null }
}));
vi.mock('$core/stores/addresses.svelte', () => ({
	addresses: { items: [], sendable: [], getByEmail: () => undefined, getByRecipient: () => undefined }
}));
vi.mock('$core/stores/contacts.svelte', () => ({
	contacts: { items: [], ensureLoaded: async () => {} }
}));
vi.mock('$core/stores/signatures.svelte', () => ({
	signatures: { loaded: true, bodyFor: () => '', effectiveFor: () => null }
}));
vi.mock('$core/stores/accountSettings.svelte', () => ({
	accountSettings: { privacy: { stripTrackingParams: false }, composing: {} }
}));
vi.mock('$core/stores/replyPresence.svelte', () => ({
	replyPresence: { replying: [] },
	announceReplying: () => () => {}
}));
vi.mock('$core/stores/drafts.svelte', () => ({
	drafts: { upsertLocal: () => {}, remove: () => {} },
	rowFromDoc: () => null
}));
vi.mock('$core/stores/personAvatars.svelte', () => ({
	personAvatars: { avatarUrl: () => null }
}));
vi.mock('$core/stores/restartGuard', () => ({ holdRestart: () => () => {} }));
vi.mock('$core/stores/leaveGuard', () => ({ holdLeave: () => () => {} }));

const source = {
	id: 'msg-1',
	subj: 'Studio move plan',
	from: 'Mira Costa',
	fromAddr: 'mira@atelier.test',
	recipients: [{ name: 'Me Tester', address: 'me@thelemail.com', kind: 'to' }],
	replyTo: [],
	folder: 'inbox',
	direction: 'received',
	epoch: Date.UTC(2026, 9, 28, 23, 39)
} as unknown as Message;

function chipEmails(box: HTMLElement, label: string): string[] {
	const field = [...box.querySelectorAll<HTMLElement>('.recip-row')].find(
		(row) => row.querySelector('.recip-label')?.textContent?.trim() === label
	);
	return [...(field?.querySelectorAll<HTMLElement>('.rchip .rtx') ?? [])].map((c) => c.textContent?.trim() ?? '');
}

function snapshot(box: HTMLElement) {
	return {
		to: chipEmails(box, 'To'),
		bcc: chipEmails(box, 'Bcc'),
		from: box.querySelector('.from-row')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
		subject: box.querySelector('.subj-static')?.textContent,
		body: box.querySelector('.ProseMirror')?.textContent,
		files: [...box.querySelectorAll('.apv-name')].map((n) => n.textContent)
	};
}

describe('ReplyBox expand', () => {
	beforeEach(() => vi.stubGlobal('fetch', () => new Promise<never>(() => {})));
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('keeps every draft field and the caret when it moves into the workspace and back', async () => {
		let expanded = false;
		const view = render(ReplyBox, {
			props: {
				m: source,
				mode: 'reply',
				expanded,
				onClose: () => {},
				onMode: () => {},
				onPane: () => {},
				onExpand: (next: boolean) => {
					expanded = next;
					void view.rerender({ expanded: next });
				}
			}
		});
		const box = view.container.querySelector<HTMLElement>('.replybox')!;
		const editor = box.querySelector<HTMLElement>('.ProseMirror')!;
		await vi.waitFor(() => expect(editor.getAttribute('contenteditable')).toBe('true'));

		await userEvent.click(editor);
		await userEvent.keyboard('Hello world');
		for (let i = 0; i < 5; i++) await userEvent.keyboard('{ArrowLeft}');

		await userEvent.click(box.querySelector<HTMLButtonElement>('.ccbcc button:last-child')!);
		const bccInput = [...box.querySelectorAll<HTMLInputElement>('.recip-input')].at(-1)!;
		await userEvent.type(bccInput, 'ledger@thelemail.com{Enter}');

		const input = box.querySelector<HTMLInputElement>('.att-hidden-input')!;
		const files = new DataTransfer();
		files.items.add(new File(['plan'], 'floor-plan.pdf', { type: 'application/pdf' }));
		input.files = files.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await userEvent.click(editor);
		for (let i = 0; i < 5; i++) await userEvent.keyboard('{ArrowLeft}');

		await vi.waitFor(() => expect(snapshot(box).files).toEqual(['floor-plan.pdf']));
		const before = snapshot(box);
		expect(before.to).toEqual(['Mira Costa']);
		expect(before.bcc).toEqual(['ledger@thelemail.com']);
		expect(before.body).toBe('Hello world');

		await userEvent.click(box.querySelector<HTMLButtonElement>('.rt-size')!);
		await vi.waitFor(() => expect(box.classList.contains('expanded')).toBe(true));
		expect(expanded).toBe(true);
		expect(view.container.querySelector('.replybox')).toBe(box);
		expect(box.querySelector('.ProseMirror')).toBe(editor);
		expect(box.querySelector('[role="radiogroup"]')).toBeTruthy();
		expect(snapshot(box)).toEqual(before);

		await vi.waitFor(() => expect(document.activeElement).toBe(editor));
		await userEvent.keyboard('big ');
		expect(editor.textContent).toBe('Hello big world');

		await userEvent.click(box.querySelector<HTMLButtonElement>('.rt-size')!);
		await vi.waitFor(() => expect(box.classList.contains('expanded')).toBe(false));
		expect(view.container.querySelector('.replybox')).toBe(box);
		expect(snapshot(box)).toEqual({ ...before, body: 'Hello big world' });
	});
});
