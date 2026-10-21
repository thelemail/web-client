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

const directoryTrust = vi.fn();
const previousSenderKey = vi.fn();

vi.mock('$core/mail/senderVerify', () => ({
	directoryTrust: (...a: unknown[]) => directoryTrust(...a),
	previousSenderKey: (...a: unknown[]) => previousSenderKey(...a),
	externalKeyState: vi.fn(async () => null),
	delegatedSignerTrust: vi.fn(async () => null)
}));

vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'acc-1', email: 'me@example.org' }
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
	directoryTrust.mockReset();
	directoryTrust.mockResolvedValue(null);
	previousSenderKey.mockReset();
	previousSenderKey.mockResolvedValue(null);
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

describe('signatures from a sender\u2019s previous key', () => {
	const CURRENT_FP = 'c1'.repeat(32);
	const PREVIOUS_V6 = 'a6'.repeat(32);
	const PREVIOUS_V4 = 'b4'.repeat(20);
	const RETIRED_AT = Date.parse('2026-10-01T00:00:00Z');

	function internal(id: string, storedAt = '2026-10-01T00:01:00Z') {
		return { ...item(id), source: 'internal', storedAt };
	}

	function trustWith(...previous: string[]) {
		return {
			ok: true,
			firstContact: false,
			sameWorkspace: false,
			tlog: { state: 'not_configured' },
			publicKeyArmored: 'current-armored',
			statement: {
				accountId: 'acc-2',
				address: 'a@example.org',
				issuedAt: '2026-10-02T00:00:00Z',
				keyAlgorithm: 'ed25519',
				signingKeyFingerprint: 'e5'.repeat(32),
				version: 3,
				keyFingerprint: CURRENT_FP,
				keyTransitions: previous.map((fp) => ({
					previousKeyFingerprint: fp,
					retiredAt: '2026-10-01T00:00:00Z',
					retiredAtMillis: RETIRED_AT,
					signature: new Uint8Array()
				}))
			}
		};
	}

	function signedBy(first: Record<string, unknown>, second?: Record<string, unknown>) {
		renderDetail.mockImplementation(async (_a: string, detail: { id: string }, opts: { verificationKeysArmored?: string[] }) => ({
			render: { srcDoc: `<p>${detail.id}</p>` },
			signature: opts.verificationKeysArmored?.includes('previous-armored') ? second : first
		}));
	}

	async function loaded(storedAt?: string) {
		getMessageThread.mockResolvedValue({ threadRootId: 'a', items: [internal('a', storedAt)] });
		const thread = await hydrateThread('a');
		return thread!.load('a');
	}

	it('verifies against the listed previous key fetched by fingerprint', async () => {
		directoryTrust.mockResolvedValue(trustWith(PREVIOUS_V6));
		previousSenderKey.mockResolvedValue({
			fingerprintHex: PREVIOUS_V6,
			publicKeyArmored: 'previous-armored',
			retiredAtMillis: RETIRED_AT
		});
		signedBy(
			{ state: 'unknown_key', issuerFingerprintHex: PREVIOUS_V6.toUpperCase() },
			{ state: 'valid', keyFingerprintHex: PREVIOUS_V6, signedAtMillis: RETIRED_AT - 60_000 }
		);
		const entry = await loaded();
		expect(previousSenderKey).toHaveBeenCalledWith('acc-1', 'a@example.org', PREVIOUS_V6);
		expect(renderDetail).toHaveBeenLastCalledWith(
			'acc-1',
			expect.objectContaining({ id: 'a' }),
			expect.objectContaining({ verificationKeysArmored: ['current-armored', 'previous-armored'] })
		);
		expect(entry?.trust?.facts.signature).toEqual({
			state: 'valid',
			keyFingerprintHex: PREVIOUS_V6,
			signedAtMillis: RETIRED_AT - 60_000,
			previousKeyRetiredAtMillis: RETIRED_AT
		});
	});

	it('matches a signature that only names the issuer key ID', async () => {
		directoryTrust.mockResolvedValue(trustWith(PREVIOUS_V6, PREVIOUS_V4));
		previousSenderKey.mockResolvedValue({
			fingerprintHex: PREVIOUS_V4,
			publicKeyArmored: 'previous-armored',
			retiredAtMillis: RETIRED_AT
		});
		signedBy(
			{ state: 'unknown_key', issuerKeyIdHex: PREVIOUS_V4.slice(-16).toUpperCase() },
			{ state: 'valid', keyFingerprintHex: PREVIOUS_V4, signedAtMillis: RETIRED_AT }
		);
		const entry = await loaded();
		expect(previousSenderKey).toHaveBeenCalledWith('acc-1', 'a@example.org', PREVIOUS_V4);
		expect(entry?.trust?.facts.signature?.state).toBe('valid');
	});

	it('rejects a previous-key signature made after the key was retired', async () => {
		directoryTrust.mockResolvedValue(trustWith(PREVIOUS_V6));
		previousSenderKey.mockResolvedValue({
			fingerprintHex: PREVIOUS_V6,
			publicKeyArmored: 'previous-armored',
			retiredAtMillis: RETIRED_AT
		});
		signedBy(
			{ state: 'unknown_key', issuerFingerprintHex: PREVIOUS_V6 },
			{ state: 'valid', keyFingerprintHex: PREVIOUS_V6, signedAtMillis: RETIRED_AT + 5 * 60_000 }
		);
		const entry = await loaded();
		expect(entry?.trust?.facts.signature).toEqual({
			state: 'invalid',
			keyFingerprintHex: PREVIOUS_V6,
			signedAtMillis: RETIRED_AT + 5 * 60_000
		});
	});

	it('leaves a previous-key signature the server stored after the window unverified', async () => {
		directoryTrust.mockResolvedValue(trustWith(PREVIOUS_V6));
		previousSenderKey.mockResolvedValue({
			fingerprintHex: PREVIOUS_V6,
			publicKeyArmored: 'previous-armored',
			retiredAtMillis: RETIRED_AT
		});
		signedBy(
			{ state: 'unknown_key', issuerFingerprintHex: PREVIOUS_V6 },
			{ state: 'valid', keyFingerprintHex: PREVIOUS_V6, signedAtMillis: RETIRED_AT - 60_000 }
		);
		const entry = await loaded('2026-10-01T00:05:00Z');
		expect(entry?.trust?.facts.signature?.state).toBe('unknown_key');
	});

	it('ignores a previous key the sender\u2019s statement does not list', async () => {
		directoryTrust.mockResolvedValue(trustWith(PREVIOUS_V6));
		signedBy({ state: 'unknown_key', issuerFingerprintHex: 'dd'.repeat(32) });
		const entry = await loaded();
		expect(previousSenderKey).not.toHaveBeenCalled();
		expect(renderDetail).toHaveBeenCalledTimes(1);
		expect(entry?.trust?.facts.signature?.state).toBe('unknown_key');
	});

	it('keeps the original verdict when the previous key signature belongs to another key', async () => {
		directoryTrust.mockResolvedValue(trustWith(PREVIOUS_V6));
		previousSenderKey.mockResolvedValue({
			fingerprintHex: PREVIOUS_V6,
			publicKeyArmored: 'previous-armored',
			retiredAtMillis: RETIRED_AT
		});
		signedBy(
			{ state: 'unknown_key', issuerFingerprintHex: PREVIOUS_V6 },
			{ state: 'valid', keyFingerprintHex: CURRENT_FP, signedAtMillis: RETIRED_AT }
		);
		const entry = await loaded();
		expect(entry?.trust?.facts.signature?.state).toBe('unknown_key');
	});
});

describe('own messages', () => {
	function fromMe(direction: 'sent' | 'received') {
		decryptPreview.mockResolvedValue({
			sender: { display: 'Me Myself', address: 'me@example.org' },
			recipients: [{ kind: 'to', address: 'me@example.org' }],
			subject: 'Subject',
			snippet: 'Snippet'
		});
		getMessageThread.mockResolvedValue({
			threadRootId: 'a',
			items: [{ ...item('a'), direction, source: 'internal' }]
		});
	}

	it('treats a received message from one of my addresses as received', async () => {
		fromMe('received');
		const thread = await hydrateThread('a');
		expect(thread?.entries[0].me).toBe(false);
		expect(thread?.entries[0].from).toBe('Me Myself');

		const entry = await thread!.load('a');
		expect(directoryTrust).toHaveBeenCalledWith('acc-1', 'me@example.org');
		expect(entry?.me).toBe(false);
		expect(entry?.trust).toBeDefined();
	});

	it('shows a sent message as mine without a trust evaluation', async () => {
		fromMe('sent');
		const thread = await hydrateThread('a');
		expect(thread?.entries[0].me).toBe(true);
		expect(thread?.entries[0].from).toBe('You');

		const entry = await thread!.load('a');
		expect(directoryTrust).not.toHaveBeenCalled();
		expect(entry?.trust).toBeUndefined();
	});
});
