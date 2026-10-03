import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMessageThread = vi.fn();
const decryptPreview = vi.fn();
const renderDetail = vi.fn();

vi.mock('$core/api/messages', () => ({
	getMessageThread: (...a: unknown[]) => getMessageThread(...a)
}));

vi.mock('$core/mail/decrypt', () => ({
	decryptPreview: (...a: unknown[]) => decryptPreview(...a),
	DecryptionError: class DecryptionError extends Error {}
}));

vi.mock('$core/mail/bodySource', () => ({
	renderDetail: (...a: unknown[]) => renderDetail(...a)
}));

vi.mock('$core/mail/senderVerify', () => ({
	directoryTrust: vi.fn(async () => null),
	externalKeyState: vi.fn(async () => null),
	delegatedSignerTrust: vi.fn(async () => null)
}));

vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'acc-1', email: 'me@example.org' }
}));

vi.mock('$core/stores/addresses.svelte', () => ({
	addresses: { items: [] }
}));

vi.mock('$core/stores/accountSettings.svelte', () => ({
	accountSettings: { privacy: { stripTrackingParams: false } }
}));

vi.mock('$platform', () => ({ platform: {} }));

import { hydrateThread } from './hydrateThread';

function item(id: string, read = true) {
	return {
		id,
		ownerAccountId: 'acc-1',
		direction: 'received',
		source: 'external',
		storedAt: '2026-10-03T12:00:00Z',
		encryptedPreview: `enc-${id}`,
		mailboxState: 'inbox',
		read,
		attachments: []
	};
}

beforeEach(() => {
	getMessageThread.mockReset();
	decryptPreview.mockReset();
	renderDetail.mockReset();
	decryptPreview.mockImplementation(async (_a: string, b64: string) => {
		const id = b64.replace('enc-', '');
		return {
			sender: { display: `Sender ${id}`, address: `${id}@example.org` },
			recipients: [{ kind: 'to', address: 'me@example.org' }],
			subject: 'Subject',
			snippet: `Snippet ${id}`
		};
	});
	renderDetail.mockImplementation(async (_a: string, detail: { id: string }) => ({
		render: { srcDoc: `<p>${detail.id}</p>` }
	}));
});

describe('hydrateThread', () => {
	it('decrypts previews for every message but renders no bodies up front', async () => {
		getMessageThread.mockResolvedValue({ threadRootId: 'a', items: [item('a'), item('b', false), item('c')] });
		const thread = await hydrateThread('c');

		expect(thread?.entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
		expect(thread?.entries.map((e) => e.body[0])).toEqual(['Snippet a', 'Snippet b', 'Snippet c']);
		expect(thread?.entries.map((e) => e.unread)).toEqual([false, true, false]);
		expect(thread?.entries.every((e) => !e.loaded && !e.srcDoc)).toBe(true);
		expect(renderDetail).not.toHaveBeenCalled();
	});

	it('renders one body on demand and reuses it', async () => {
		getMessageThread.mockResolvedValue({ threadRootId: 'a', items: [item('a'), item('b')] });
		const thread = await hydrateThread('b');

		const first = await thread!.load('b');
		const again = await thread!.load('b');

		expect(first?.loaded).toBe(true);
		expect(first?.srcDoc).toBe('<p>b</p>');
		expect(again).toBe(first);
		expect(renderDetail).toHaveBeenCalledTimes(1);
	});

	it('renders at most three bodies at once', async () => {
		const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
		getMessageThread.mockResolvedValue({ threadRootId: 'a', items: ids.map((id) => item(id)) });
		let active = 0;
		let peak = 0;
		renderDetail.mockImplementation(async (_a: string, detail: { id: string }) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 5));
			active--;
			return { render: { srcDoc: detail.id } };
		});
		const thread = await hydrateThread('f');

		const all = await Promise.all(ids.map((id) => thread!.load(id)));

		expect(all.map((e) => e?.srcDoc)).toEqual(ids);
		expect(peak).toBe(3);
	});

	it('gives nothing back for an id outside the thread', async () => {
		getMessageThread.mockResolvedValue({ threadRootId: 'a', items: [item('a')] });
		const thread = await hydrateThread('a');
		await expect(thread!.load('zzz')).resolves.toBeNull();
	});
});
