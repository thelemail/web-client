import { describe, expect, it } from 'vitest';
import { excerptFor, isEmptyQuery, matchesFrom, matchesRow, parseQuery, parseTerms, scoreText, splitRespectingQuotes } from './query';
import type { IndexedRow, IndexedText } from './types';

function text(over: Partial<IndexedText> = {}): IndexedText {
	return {
		id: 'm1',
		subject: '',
		senderDisplay: '',
		senderAddress: '',
		recipients: '',
		snippet: '',
		...over
	};
}

describe('parseTerms', () => {
	it('lowercases, strips diacritics and drops punctuation', () => {
		expect(parseTerms('Café, Invoice!')).toEqual(['cafe', 'invoice']);
	});

	it('keeps address punctuation so a sender can be searched whole', () => {
		expect(parseTerms('anna@school.pt')).toEqual(['anna@school.pt']);
	});

	it('returns nothing for a blank query', () => {
		expect(parseTerms('   ')).toEqual([]);
	});

	it('caps the number of terms', () => {
		const many = Array.from({ length: 40 }, (_, i) => `t${i}`).join(' ');
		expect(parseTerms(many)).toHaveLength(16);
	});
});

describe('scoreText', () => {
	it('ranks a subject match above a snippet match', () => {
		const subject = scoreText(text({ subject: 'Invoice 42' }), ['invoice']);
		const snippet = scoreText(text({ snippet: 'the invoice is attached' }), ['invoice']);
		expect(subject).toBeGreaterThan(snippet);
	});

	it('ranks a sender match above a recipient match', () => {
		const sender = scoreText(text({ senderDisplay: 'Anna Reis' }), ['anna']);
		const recipient = scoreText(text({ recipients: 'Anna Reis anna@x.pt' }), ['anna']);
		expect(sender).toBeGreaterThan(recipient);
	});

	it('requires every term to match somewhere', () => {
		const record = text({ subject: 'Invoice 42', snippet: 'due friday' });
		expect(scoreText(record, ['invoice', 'friday'])).toBeGreaterThan(0);
		expect(scoreText(record, ['invoice', 'monday'])).toBe(0);
	});

	it('matches a diacritic-free query against accented mail', () => {
		expect(scoreText(text({ subject: 'Reunião da escola' }), ['reuniao'])).toBeGreaterThan(0);
	});

	it('scores a word start higher than a mid-word hit', () => {
		const start = scoreText(text({ subject: 'invoice' }), ['inv']);
		const middle = scoreText(text({ subject: 'reinvoice' }), ['inv']);
		expect(start).toBeGreaterThan(middle);
	});

	it('scores nothing without terms', () => {
		expect(scoreText(text({ subject: 'Invoice' }), [])).toBe(0);
	});
});

describe('excerptFor', () => {
	it('windows the snippet around the first match', () => {
		const long = `${'a '.repeat(80)}invoice ${'b '.repeat(80)}`;
		const out = excerptFor(text({ snippet: long }), ['invoice']);
		expect(out).toContain('invoice');
		expect(out.length).toBeLessThan(long.length);
		expect(out.startsWith('…')).toBe(true);
	});

	it('falls back to the snippet when nothing matches it', () => {
		expect(excerptFor(text({ subject: 'Invoice', snippet: 'nothing' }), ['invoice'])).toBe(
			'nothing'
		);
	});
});

function row(over: Partial<IndexedRow> = {}): IndexedRow {
	return {
		accountId: 'acc-1',
		id: 'm1',
		chunkId: 0,
		storedAt: 1_700_000_000_000,
		direction: 'received',
		mailboxState: 'inbox',
		read: true,
		starred: false,
		labels: [],
		attachmentCount: 0,
		threadRootId: null,
		snoozedUntil: null,
		...over
	};
}

describe('splitRespectingQuotes', () => {
	it('keeps a quoted phrase together and drops the quotes', () => {
		expect(splitRespectingQuotes('from:"anna reis" invoice')).toEqual([
			'from:anna reis',
			'invoice'
		]);
	});

	it('collapses runs of whitespace', () => {
		expect(splitRespectingQuotes('  a   b  ')).toEqual(['a', 'b']);
	});

	it('closes an unterminated quote at the end of input', () => {
		expect(splitRespectingQuotes('"anna reis')).toEqual(['anna reis']);
	});
});

describe('parseQuery operators', () => {
	it('keeps operators out of the free text', () => {
		const parsed = parseQuery('invoice from:alice@example.com in:archive is:unread has:attachment');
		expect(parsed.terms).toEqual(['invoice']);
		expect(parsed.from).toEqual(['alice@example.com']);
		expect(parsed.folder).toBe('archive');
		expect(parsed.unread).toBe(true);
		expect(parsed.hasAttachment).toBe(true);
	});

	it('accepts operators whatever their case', () => {
		const parsed = parseQuery('From:Anna Is:UNREAD Has:Attachment In:Sent');
		expect(parsed.from).toEqual(['anna']);
		expect(parsed.unread).toBe(true);
		expect(parsed.hasAttachment).toBe(true);
		expect(parsed.folder).toBe('sent');
		expect(parsed.terms).toEqual([]);
	});

	it('takes a quoted sender with a space in it', () => {
		expect(parseQuery('from:"anna reis"').from).toEqual(['anna reis']);
	});

	it('accumulates several senders and lets the last folder win', () => {
		const parsed = parseQuery('from:anna from:reis in:spam in:trash');
		expect(parsed.from).toEqual(['anna', 'reis']);
		expect(parsed.folder).toBe('trash');
	});

	it('reads is:read as the opposite of is:unread', () => {
		expect(parseQuery('is:read').unread).toBe(false);
		expect(parseQuery('is:unread').unread).toBe(true);
	});

	it('leaves an unknown prefix as free text', () => {
		expect(parseQuery('foo:bar').terms).toEqual(['foo', 'bar']);
	});

	it('leaves a bare operator as free text', () => {
		expect(parseQuery('from:').terms).toEqual(['from']);
		expect(parseQuery('from:').from).toEqual([]);
	});

	it('records an unrecognised folder rather than ignoring it', () => {
		const parsed = parseQuery('in:nowhere');
		expect(parsed.folder).toBeNull();
		expect(parsed.unknownFolder).toBe('nowhere');
	});

	it('treats a query that parses to nothing as empty', () => {
		expect(isEmptyQuery(parseQuery('()'))).toBe(true);
		expect(isEmptyQuery(parseQuery('   '))).toBe(true);
		expect(isEmptyQuery(parseQuery('is:unread'))).toBe(false);
		expect(isEmptyQuery(parseQuery('invoice'))).toBe(false);
	});
});

describe('matchesRow', () => {
	it('separates sent from inbox even though both are the inbox mailbox', () => {
		const received = row({ direction: 'received', mailboxState: 'inbox' });
		const sent = row({ direction: 'sent', mailboxState: 'inbox' });
		expect(matchesRow(received, parseQuery('in:inbox'))).toBe(true);
		expect(matchesRow(sent, parseQuery('in:inbox'))).toBe(false);
		expect(matchesRow(sent, parseQuery('in:sent'))).toBe(true);
		expect(matchesRow(received, parseQuery('in:sent'))).toBe(false);
	});

	it('files a sent message in its mailbox once it leaves the inbox', () => {
		const archived = row({ direction: 'sent', mailboxState: 'archive' });
		expect(matchesRow(archived, parseQuery('in:archive'))).toBe(true);
		expect(matchesRow(archived, parseQuery('in:sent'))).toBe(false);
	});

	it('treats in:starred as the starred flag', () => {
		expect(matchesRow(row({ starred: true }), parseQuery('in:starred'))).toBe(true);
		expect(matchesRow(row({ starred: false }), parseQuery('in:starred'))).toBe(false);
	});

	it('matches nothing for an unrecognised folder', () => {
		expect(matchesRow(row(), parseQuery('in:nowhere'))).toBe(false);
	});

	it('applies the read, starred and attachment filters', () => {
		expect(matchesRow(row({ read: false }), parseQuery('is:unread'))).toBe(true);
		expect(matchesRow(row({ read: true }), parseQuery('is:unread'))).toBe(false);
		expect(matchesRow(row({ read: true }), parseQuery('is:read'))).toBe(true);
		expect(matchesRow(row({ starred: true }), parseQuery('is:starred'))).toBe(true);
		expect(matchesRow(row({ attachmentCount: 2 }), parseQuery('has:attachment'))).toBe(true);
		expect(matchesRow(row({ attachmentCount: 0 }), parseQuery('has:attachment'))).toBe(false);
	});
});

describe('matchesFrom', () => {
	const sender = text({ senderDisplay: 'Anna Reis', senderAddress: 'anna@school.pt' });

	it('matches a substring of the address or the display name', () => {
		expect(matchesFrom(sender, parseQuery('from:school'))).toBe(true);
		expect(matchesFrom(sender, parseQuery('from:reis'))).toBe(true);
		expect(matchesFrom(sender, parseQuery('from:bob'))).toBe(false);
	});

	it('requires every from: to match', () => {
		expect(matchesFrom(sender, parseQuery('from:anna from:school'))).toBe(true);
		expect(matchesFrom(sender, parseQuery('from:anna from:bob'))).toBe(false);
	});

	it('ignores diacritics on both sides', () => {
		const accented = text({ senderDisplay: 'Renée', senderAddress: 'r@x.pt' });
		expect(matchesFrom(accented, parseQuery('from:renee'))).toBe(true);
	});

	it('does not restrict a query with no from:', () => {
		expect(matchesFrom(sender, parseQuery('invoice'))).toBe(true);
	});
});
