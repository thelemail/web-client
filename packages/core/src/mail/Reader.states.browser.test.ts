import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { INDICATOR_DELAY_MS } from '$core/async/delayed.svelte';

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

const bodyLoads = vi.hoisted(() => [] as PromiseWithResolvers<unknown>[]);

vi.mock('./bodySource', () => ({
	loadMessageBody: vi.fn(() => {
		const next = Promise.withResolvers<unknown>();
		bodyLoads.push(next);
		return next.promise;
	})
}));
vi.mock('./hydrateThread', () => ({ hydrateThread: vi.fn(async () => null) }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'acc-1', canEnterApp: true, email: 'me@thelemail.test', fullName: 'Me' }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({
	page: { params: { slot: '0' }, url: new URL('https://app.test/u/0/mail/inbox'), state: {} }
}));
vi.mock('$platform', () => ({ platform: { openLink: vi.fn() } }));

import Reader from './Reader.svelte';
import { mailActionsFor } from './actions';
import type { Message } from './data';

function message(id: string): Message {
	return {
		id,
		folder: 'inbox',
		direction: 'received',
		from: 'Anna',
		fromAddr: 'anna@school.test',
		to: 'me@thelemail.test',
		init: 'A',
		bg: '#fff',
		fg: '#000',
		subj: 'Permission slip',
		labels: [],
		unread: false,
		starred: false,
		prev: 'please sign',
		body: [],
		epoch: 1_700_000_000_000
	};
}

function props(m: Message) {
	return {
		m,
		caps: mailActionsFor('inbox'),
		onToggleStar: () => {},
		onArchive: () => {},
		onTrash: () => {}
	};
}

function ready() {
	return {
		detail: { attachments: [] },
		render: { srcDoc: '<p>hello</p>', calendarEvents: [], contentText: 'hello' }
	};
}

beforeEach(() => {
	bodyLoads.length = 0;
	vi.useFakeTimers();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('Reader while the body decrypts', () => {
	it('shows the subject and actions from the row at once and keeps them', async () => {
		const { container, getByRole } = render(Reader, { props: props(message('m1')) });
		expect(getByRole('heading', { level: 1 }).textContent).toContain('Permission slip');
		expect(container.querySelector('.reader-bar')).not.toBeNull();
		await vi.advanceTimersByTimeAsync(INDICATOR_DELAY_MS * 3);
		expect(getByRole('heading', { level: 1 }).textContent).toContain('Permission slip');
		expect(container.querySelector('.reader-bar')).not.toBeNull();
	});

	it('shows the decrypting placeholder only in the body and only after the delay', async () => {
		const { container } = render(Reader, { props: props(message('m1')) });
		await vi.advanceTimersByTimeAsync(INDICATOR_DELAY_MS - 1);
		expect(container.querySelector('.bp')).toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		expect(container.querySelector('.email-sheet .bp')).not.toBeNull();
	});

	it('shows no placeholder when the body arrives before the delay', async () => {
		const { container } = render(Reader, { props: props(message('m1')) });
		bodyLoads[0].resolve(ready());
		await vi.advanceTimersByTimeAsync(INDICATOR_DELAY_MS * 2);
		expect(container.querySelector('.bp')).toBeNull();
	});

	it('waits again for the next message instead of jumping straight to the placeholder', async () => {
		const view = render(Reader, { props: props(message('m1')) });
		await vi.advanceTimersByTimeAsync(INDICATOR_DELAY_MS);
		expect(view.container.querySelector('.bp')).not.toBeNull();
		await view.rerender(props(message('m2')));
		expect(view.container.querySelector('.bp')).toBeNull();
	});

	it('keeps retrying quietly and offers a retry once every attempt failed', async () => {
		const { container, getByRole } = render(Reader, { props: props(message('m1')) });
		bodyLoads[0].reject(new Error('one'));
		await vi.advanceTimersByTimeAsync(800);
		expect(container.querySelector('[role="alert"]')).toBeNull();
		bodyLoads[1].reject(new Error('two'));
		await vi.advanceTimersByTimeAsync(1600);
		expect(container.querySelector('[role="alert"]')).toBeNull();
		bodyLoads[2].reject(new Error('three'));
		await vi.advanceTimersByTimeAsync(10);
		expect(getByRole('alert').textContent).toContain('three');
		await fireEvent.click(getByRole('button', { name: /try again/i }));
		expect(bodyLoads).toHaveLength(4);
	});
});
