import { describe, it, expect } from 'vitest';
import { replyTargets, type ReplySeed } from './replyRecipients';
import type { MessagePreviewRecipient } from './preview';

function r(address: string, kind: MessagePreviewRecipient['kind'], display = ''): MessagePreviewRecipient {
	return { display, address, kind };
}

function seed(overrides: Partial<ReplySeed> = {}): ReplySeed {
	return {
		sender: { display: 'Alice', address: 'alice@example.com' },
		senderIsMe: false,
		recipients: [r('me@example.com', 'to'), r('bob@example.com', 'to'), r('carol@example.com', 'cc')],
		...overrides
	};
}

const me = new Set(['me@example.com']);
const addrs = (xs: { address: string }[]) => xs.map((x) => x.address);

describe('replyTargets reply mode', () => {
	it('targets the sender only', () => {
		const { to, cc } = replyTargets(seed(), 'reply', me);
		expect(addrs(to)).toEqual(['alice@example.com']);
		expect(cc).toEqual([]);
	});

	it('keeps the sender display name', () => {
		const { to } = replyTargets(seed(), 'reply', me);
		expect(to[0].display).toBe('Alice');
	});

	it('replies to the original to list when the sender is me', () => {
		const s = seed({
			sender: { display: 'Me', address: 'me@example.com' },
			senderIsMe: true
		});
		const { to, cc } = replyTargets(s, 'reply', me);
		expect(addrs(to)).toEqual(['me@example.com', 'bob@example.com']);
		expect(cc).toEqual([]);
	});

	it('detects sender-is-me from myEmails even without the flag', () => {
		const s = seed({ sender: { display: 'Me', address: 'ME@Example.com' } });
		const { to } = replyTargets(s, 'reply', me);
		expect(addrs(to)).toEqual(['me@example.com', 'bob@example.com']);
	});
});

describe('replyTargets all mode', () => {
	it('puts sender plus remaining to recipients in to, cc stays cc', () => {
		const { to, cc } = replyTargets(seed(), 'all', me);
		expect(addrs(to)).toEqual(['alice@example.com', 'bob@example.com']);
		expect(addrs(cc)).toEqual(['carol@example.com']);
	});

	it('drops all of my aliases, not just the primary address', () => {
		const mine = new Set(['me@example.com', 'alias@example.com']);
		const s = seed({
			recipients: [
				r('alias@example.com', 'to'),
				r('bob@example.com', 'to'),
				r('me@example.com', 'cc')
			]
		});
		const { to, cc } = replyTargets(s, 'all', mine);
		expect(addrs(to)).toEqual(['alice@example.com', 'bob@example.com']);
		expect(cc).toEqual([]);
	});

	it('dedupes case-insensitively and never repeats the sender', () => {
		const s = seed({
			recipients: [
				r('Alice@Example.com', 'to'),
				r('bob@example.com', 'to'),
				r('BOB@example.com', 'cc'),
				r('carol@example.com', 'cc')
			]
		});
		const { to, cc } = replyTargets(s, 'all', me);
		expect(addrs(to)).toEqual(['alice@example.com', 'bob@example.com']);
		expect(addrs(cc)).toEqual(['carol@example.com']);
	});

	it('handles reply-all on my own sent message', () => {
		const s = seed({
			sender: { display: 'Me', address: 'me@example.com' },
			senderIsMe: true,
			recipients: [r('bob@example.com', 'to'), r('carol@example.com', 'cc')]
		});
		const { to, cc } = replyTargets(s, 'all', me);
		expect(addrs(to)).toEqual(['bob@example.com']);
		expect(addrs(cc)).toEqual(['carol@example.com']);
	});

	it('falls back to the original to list for self-mail', () => {
		const s = seed({
			sender: { display: 'Me', address: 'me@example.com' },
			senderIsMe: true,
			recipients: [r('me@example.com', 'to')]
		});
		const { to, cc } = replyTargets(s, 'all', me);
		expect(addrs(to)).toEqual(['me@example.com']);
		expect(cc).toEqual([]);
	});

	it('ignores bcc recipients', () => {
		const s = seed({
			recipients: [r('bob@example.com', 'to'), r('hidden@example.com', 'bcc')]
		});
		const { to, cc } = replyTargets(s, 'all', me);
		expect(addrs(to)).toEqual(['alice@example.com', 'bob@example.com']);
		expect(cc).toEqual([]);
	});
});

describe('replyTargets fallback', () => {
	it('uses the original to list when the sender address is missing', () => {
		const s = seed({ sender: { display: 'Ghost', address: '' } });
		const { to } = replyTargets(s, 'reply', me);
		expect(addrs(to)).toEqual(['me@example.com', 'bob@example.com']);
	});
});
