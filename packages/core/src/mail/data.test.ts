import { describe, it, expect } from 'vitest';
import {
	sortMessages,
	bucketFromEpoch,
	chipsFromInput,
	folderFromServer,
	type Contact,
	type Message,
	type SortId
} from './data';
import { mailActionsFor } from './actions';

function row(overrides: Partial<Message> & Pick<Message, 'id' | 'epoch'>): Message {
	return {
		folder: 'inbox',
		direction: 'received',
		from: '',
		fromAddr: '',
		to: '',
		init: '',
		bg: '',
		fg: '',
		subj: '',
		labels: [],
		unread: false,
		starred: false,
		prev: '',
		body: [],
		...overrides
	};
}

const ids = (xs: Message[]) => xs.map((m) => m.id);

describe('sortMessages', () => {
	it('newest-first sorts by epoch desc', () => {
		const list = [
			row({ id: 'a', epoch: 100 }),
			row({ id: 'b', epoch: 300 }),
			row({ id: 'c', epoch: 200 })
		];
		expect(ids(sortMessages(list, 'newest'))).toEqual(['b', 'c', 'a']);
	});

	it('oldest reverses', () => {
		const list = [
			row({ id: 'a', epoch: 100 }),
			row({ id: 'b', epoch: 300 }),
			row({ id: 'c', epoch: 200 })
		];
		expect(ids(sortMessages(list, 'oldest'))).toEqual(['a', 'c', 'b']);
	});

	it('ties at equal epoch break by id deterministically (newest)', () => {
		const list = [
			row({ id: 'a', epoch: 500 }),
			row({ id: 'z', epoch: 500 }),
			row({ id: 'm', epoch: 500 })
		];
		const first = ids(sortMessages(list, 'newest'));
		const second = ids(sortMessages([...list].reverse(), 'newest'));
		expect(first).toEqual(['z', 'm', 'a']);
		expect(second).toEqual(first);
	});

	it('ties at equal epoch break by id deterministically (oldest)', () => {
		const list = [
			row({ id: 'a', epoch: 500 }),
			row({ id: 'z', epoch: 500 }),
			row({ id: 'm', epoch: 500 })
		];
		expect(ids(sortMessages(list, 'oldest'))).toEqual(['a', 'm', 'z']);
	});

	it('does not mutate its input', () => {
		const list = [
			row({ id: 'a', epoch: 100 }),
			row({ id: 'b', epoch: 300 }),
			row({ id: 'c', epoch: 200 })
		];
		const snapshot = ids(list);
		sortMessages(list, 'newest');
		expect(ids(list)).toEqual(snapshot);
	});

	it('returns a fresh array even for an empty input', () => {
		const empty: Message[] = [];
		const out = sortMessages(empty, 'newest');
		expect(out).not.toBe(empty);
		expect(out).toEqual([]);
	});

	it('every SortId branch is reachable', () => {
		const list = [row({ id: 'a', epoch: 1 }), row({ id: 'b', epoch: 2 })];
		const sorts: SortId[] = ['newest', 'oldest'];
		for (const s of sorts) {
			expect(sortMessages(list, s)).toHaveLength(2);
		}
	});
});

describe('bucketFromEpoch', () => {
	const now = new Date('2026-06-07T18:00:00Z').getTime();

	it('classifies same calendar day as Today', () => {
		const sameDayMorning = new Date('2026-06-07T03:15:00Z').getTime();
		expect(bucketFromEpoch(sameDayMorning, now)).toBe('Today');
	});

	it('classifies up to ~6 days ago as Earlier this week', () => {
		const yesterday = now - 24 * 60 * 60 * 1000;
		const fourDaysAgo = now - 4 * 24 * 60 * 60 * 1000;
		expect(bucketFromEpoch(yesterday, now)).toBe('Earlier this week');
		expect(bucketFromEpoch(fourDaysAgo, now)).toBe('Earlier this week');
	});

	it('classifies older than 6 days as Earlier', () => {
		const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
		expect(bucketFromEpoch(tenDaysAgo, now)).toBe('Earlier');
	});

	it('does not treat exactly-6-days-ago as this week', () => {
		const sixDaysAgo = now - 6 * 24 * 60 * 60 * 1000;
		expect(bucketFromEpoch(sixDaysAgo, now)).toBe('Earlier');
	});

	it('treats future epochs as Earlier (not this week)', () => {
		const tomorrow = now + 24 * 60 * 60 * 1000;
		expect(bucketFromEpoch(tomorrow, now)).toBe('Earlier');
	});
});

describe('folderFromServer', () => {
	it('maps the snoozed mailbox to its own folder for both directions', () => {
		expect(folderFromServer('snoozed', 'received')).toBe('snoozed');
		expect(folderFromServer('snoozed', 'sent')).toBe('snoozed');
	});

	it('leaves the existing mailboxes alone', () => {
		expect(folderFromServer('inbox', 'received')).toBe('inbox');
		expect(folderFromServer('inbox', 'sent')).toBe('sent');
		expect(folderFromServer('archive', 'received')).toBe('archive');
		expect(folderFromServer('spam', 'received')).toBe('spam');
		expect(folderFromServer('trash', 'sent')).toBe('trash');
	});
});

describe('mailActionsFor', () => {
	it('offers snooze where a conversation can leave the inbox', () => {
		expect(mailActionsFor('inbox').showSnooze).toBe(true);
		expect(mailActionsFor('archive').showSnooze).toBe(true);
	});

	it('offers unsnooze only inside the snoozed folder', () => {
		expect(mailActionsFor('snoozed').showUnsnooze).toBe(true);
		expect(mailActionsFor('snoozed').showSnooze).toBe(false);
		for (const f of ['inbox', 'archive', 'sent', 'spam', 'trash', 'drafts'] as const) {
			expect(mailActionsFor(f).showUnsnooze).toBe(false);
		}
	});

	it('offers neither in spam, trash or the two holding folders', () => {
		for (const f of ['spam', 'trash', 'drafts', 'scheduled'] as const) {
			expect(mailActionsFor(f).showSnooze).toBe(false);
			expect(mailActionsFor(f).showUnsnooze).toBe(false);
		}
	});
});

describe('chipsFromInput', () => {
	const contacts: Contact[] = [
		{ name: 'Ada Lovelace', email: 'ada@x.com', init: 'AL', bg: 'b', fg: 'f' }
	];

	it('accepts the RFC 5322 form pasted from another mail client', () => {
		expect(chipsFromInput('Victor Hugo <victor@example.com>')).toEqual([
			{
				name: 'Victor Hugo',
				email: 'victor@example.com',
				init: 'V',
				bg: 'var(--paper-200)',
				fg: 'var(--ink-700)',
				valid: true
			}
		]);
	});

	it('keeps a bare address labelled by its address', () => {
		const [chip] = chipsFromInput('a@x.com');
		expect(chip.name).toBe('a@x.com');
		expect(chip.email).toBe('a@x.com');
		expect(chip.valid).toBe(true);
	});

	it('splits a multi-recipient paste without breaking a quoted name', () => {
		const chips = chipsFromInput('Alice <a@x.com>, "Bob, Jr." <b@x.com>; <c@x.com>');
		expect(chips.map((c) => [c.name, c.email, c.valid])).toEqual([
			['Alice', 'a@x.com', true],
			['Bob, Jr.', 'b@x.com', true],
			['c@x.com', 'c@x.com', true]
		]);
	});

	it('strips control characters out of a pasted display name', () => {
		const [chip] = chipsFromInput('"Vlad\r\nBcc: evil@x.com" <v@x.com>');
		expect(chip.email).toBe('v@x.com');
		expect(chip.name).not.toMatch(/[\r\n]/);
		expect(chip.valid).toBe(true);
	});

	it('unescapes a name carrying a quote and a backslash', () => {
		const [chip] = chipsFromInput('"Vlad \\"V\\" G\\\\" <v@x.com>');
		expect(chip.name).toBe('Vlad "V" G\\');
		expect(chip.valid).toBe(true);
	});

	it('prefers a known contact over the pasted display name', () => {
		const [chip] = chipsFromInput('Someone Else <ada@x.com>', contacts);
		expect(chip.name).toBe('Ada Lovelace');
		expect(chip.init).toBe('AL');
	});

	it('still marks input that is not an address invalid', () => {
		expect(chipsFromInput('not an address')[0].valid).toBe(false);
		expect(chipsFromInput('Vlad <vlad@x.com')[0].valid).toBe(false);
	});

	it('ignores empty segments', () => {
		expect(chipsFromInput(' , ; ')).toEqual([]);
	});
});
