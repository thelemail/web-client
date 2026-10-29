import { describe, it, expect } from 'vitest';
import { replyTargets, switchReplyMode, type ReplyParty, type ReplySeed } from './replyRecipients';
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

describe('replyTargets with plus-tagged own addresses', () => {
	const mine = new Set(['vlad@thelemail.com', 'support@company.com']);

	it('drops tagged copies of my own addresses from reply-all', () => {
		const { to, cc } = replyTargets(
			seed({
				recipients: [
					r('vlad+shop@thelemail.com', 'to'),
					r('bob@example.com', 'to'),
					r('Support+Billing@company.com', 'cc'),
					r('carol@example.com', 'cc')
				]
			}),
			'all',
			mine
		);
		expect(addrs(to)).toEqual(['alice@example.com', 'bob@example.com']);
		expect(addrs(cc)).toEqual(['carol@example.com']);
	});

	it('keeps tagged addresses of other people and other domains', () => {
		const { to, cc } = replyTargets(
			seed({
				recipients: [r('vlad+x@gmail.com', 'to'), r('bob+news@example.com', 'cc'), r('bob@example.com', 'cc')]
			}),
			'all',
			mine
		);
		expect(addrs(to)).toEqual(['alice@example.com', 'vlad+x@gmail.com']);
		expect(addrs(cc)).toEqual(['bob+news@example.com', 'bob@example.com']);
	});
});

describe('switchReplyMode', () => {
	const seed: ReplySeed = {
		sender: { display: 'Mira', address: 'mira@a.test' },
		senderIsMe: false,
		recipients: [
			{ display: 'Me', address: 'me@a.test', kind: 'to' },
			{ display: 'Theo', address: 'theo@a.test', kind: 'to' },
			{ display: 'Ada', address: 'ada@a.test', kind: 'cc' }
		]
	};
	const mine = new Set(['me@a.test']);
	const addr = (p: ReplyParty) => p.address;
	const make = (p: ReplyParty) => p;
	const names = (l: ReplyParty[]) => l.map((p) => p.address);

	it('adds the others without duplicates when switching to Reply all', () => {
		const start = { to: [{ display: 'Mira', address: 'MIRA@a.test' }], cc: [], bcc: [] };
		const next = switchReplyMode(start, 'all', seed, mine, [], addr, make);
		expect(names(next.to)).toEqual(['MIRA@a.test', 'theo@a.test']);
		expect(names(next.cc)).toEqual(['ada@a.test']);
		expect(next.added).toEqual(['theo@a.test', 'ada@a.test']);
	});

	it('removes only what Reply all added when switching back, keeping manual edits', () => {
		const reply = { to: [{ display: 'Mira', address: 'mira@a.test' }], cc: [], bcc: [] };
		const all = switchReplyMode(reply, 'all', seed, mine, [], addr, make);
		const edited = {
			to: [...all.to.filter((p) => p.address !== 'theo@a.test'), { display: 'Sam', address: 'sam@a.test' }],
			cc: all.cc,
			bcc: [{ display: 'Lee', address: 'lee@a.test' }]
		};
		const back = switchReplyMode(edited, 'reply', seed, mine, all.added, addr, make);
		expect(names(back.to)).toEqual(['mira@a.test', 'sam@a.test']);
		expect(back.cc).toEqual([]);
		expect(back.added).toEqual([]);
	});

	it('keeps someone the user typed in even if Reply all would also add them', () => {
		const reply = {
			to: [{ display: 'Mira', address: 'mira@a.test' }],
			cc: [{ display: 'Ada', address: 'ada@a.test' }],
			bcc: []
		};
		const all = switchReplyMode(reply, 'all', seed, mine, [], addr, make);
		expect(all.added).toEqual(['theo@a.test']);
		const back = switchReplyMode(all, 'reply', seed, mine, all.added, addr, make);
		expect(names(back.cc)).toEqual(['ada@a.test']);
	});

	it('does not add a person already sitting in Bcc', () => {
		const reply = { to: [{ display: 'Mira', address: 'mira@a.test' }], cc: [], bcc: [{ display: 'Theo', address: 'theo@a.test' }] };
		const all = switchReplyMode(reply, 'all', seed, mine, [], addr, make);
		expect(names(all.to)).toEqual(['mira@a.test']);
		expect(all.added).toEqual(['ada@a.test']);
	});
});
