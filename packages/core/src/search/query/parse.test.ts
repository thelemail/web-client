import { describe, expect, it } from 'vitest';
import { parseQuery } from './index';
import type { ParsedQuery, QueryError, QueryErrorCode, QuerySnapshot } from './ast';

const SNAP: QuerySnapshot = { now: Date.UTC(2026, 10, 13, 12), timeZone: 'Europe/Berlin' };

function ok(input: string, snapshot = SNAP): ParsedQuery {
	const result = parseQuery(input, snapshot);
	if (!result.ok) throw new Error(`${input}: ${JSON.stringify(result.error)}`);
	return result.query;
}

function err(input: string, snapshot = SNAP): QueryError {
	const result = parseQuery(input, snapshot);
	if (result.ok) throw new Error(`${input} parsed`);
	return result.error;
}

function bare(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(bare);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) if (k !== 'range') out[k] = bare(v);
		return out;
	}
	return value;
}

function shape(input: string, snapshot = SNAP): unknown {
	return bare(ok(input, snapshot).root);
}

const term = (text: string, lane = 'word') => ({ kind: 'term', text, lane });
const phrase = (text: string) => ({ kind: 'phrase', text });
const and = (...children: unknown[]) => ({ kind: 'and', children });
const or = (...children: unknown[]) => ({ kind: 'or', children });
const not = (child: unknown) => ({ kind: 'not', child });
const who = (role: string, value: unknown) => ({ kind: 'participant', role, value });
const name = (text: string, prefix = false) => ({ kind: 'name', text, prefix });
const midnight = (y: number, m: number, d: number, offsetHours: number) =>
	Date.UTC(y, m - 1, d) - offsetHours * 3_600_000;

describe('parseQuery operators', () => {
	const cases: [string, unknown][] = [
		['invoice hotel', and(term('invoice'), term('hotel'))],
		['Café', term('café')],
		['"hotel invoice"', phrase('hotel invoice')],
		['"  Hotel   Invoice "', phrase('hotel invoice')],
		['+word', { kind: 'literal', text: 'word', lane: 'word' }],
		['+INV-2026-0042', { kind: 'literal', text: 'inv-2026-0042', lane: 'identifier' }],
		['+"exact words"', phrase('exact words')],
		['invo*', { kind: 'prefix', text: 'invo' }],
		['a OR b', or(term('a'), term('b'))],
		['a or b', or(term('a'), term('b'))],
		['{a b}', or(term('a'), term('b'))],
		['{a OR b c}', or(term('a'), term('b'), term('c'))],
		['(a b) OR c', or(and(term('a'), term('b')), term('c'))],
		['a AND b', and(term('a'), term('b'))],
		['a -b', and(term('a'), not(term('b')))],
		['-(a OR b)', not(or(term('a'), term('b')))],
		['a AROUND 5 b', { kind: 'around', left: term('a'), right: term('b'), distance: 5 }],
		['"x y" around 0 z', { kind: 'around', left: phrase('x y'), right: term('z'), distance: 0 }],
		['from:alice@example.com', who('from', { kind: 'address', address: 'alice@example.com' })],
		['FROM:Alice@Example.com', who('from', { kind: 'address', address: 'alice@example.com' })],
		['to:me', who('to', { kind: 'me' })],
		['to:"me"', who('to', name('me'))],
		['cc:ali*', who('cc', name('ali', true))],
		['bcc:"Alice Smith"', who('bcc', name('alice smith'))],
		['from:(alice OR bob@x.pt)', or(who('from', name('alice')), who('from', { kind: 'address', address: 'bob@x.pt' }))],
		['from:{alice bob}', or(who('from', name('alice')), who('from', name('bob')))],
		['subject:budget', { kind: 'field', field: 'subject', child: term('budget') }],
		['subject:Re:', { kind: 'field', field: 'subject', child: term('re:', 'identifier') }],
		['subject:(budget OR forecast)', { kind: 'field', field: 'subject', child: or(term('budget'), term('forecast')) }],
		['body:"x y"', { kind: 'field', field: 'body', child: phrase('x y') }],
		['attachment:inv*', { kind: 'field', field: 'attachment', child: { kind: 'prefix', text: 'inv' } }],
		['filename:pdf', { kind: 'filename', text: 'pdf' }],
		['filename:"My File.PDF"', { kind: 'filename', text: 'my file.pdf' }],
		['filetype:.PDF', { kind: 'filetype', text: 'pdf' }],
		['has:attachment', { kind: 'has', value: 'attachment' }],
		['has:document', { kind: 'has', value: 'document' }],
		['has:spreadsheet', { kind: 'has', value: 'spreadsheet' }],
		['has:presentation', { kind: 'has', value: 'presentation' }],
		['has:image', { kind: 'has', value: 'image' }],
		['has:userlabels', { kind: 'has', value: 'userlabels' }],
		['has:nouserlabels', { kind: 'has', value: 'nouserlabels' }],
		['in:inbox', { kind: 'scope', scope: 'inbox' }],
		['in:sent', { kind: 'scope', scope: 'sent' }],
		['in:archive', { kind: 'scope', scope: 'archive' }],
		['in:snoozed', { kind: 'scope', scope: 'snoozed' }],
		['in:drafts', { kind: 'scope', scope: 'drafts' }],
		['in:scheduled', { kind: 'scope', scope: 'scheduled' }],
		['in:spam', { kind: 'scope', scope: 'spam' }],
		['in:trash', { kind: 'scope', scope: 'trash' }],
		['IN:Anywhere', { kind: 'scope', scope: 'anywhere' }],
		['in:"Projects/Invoices"', { kind: 'folder', path: 'Projects/Invoices' }],
		['in:Receipts', { kind: 'folder', path: 'Receipts' }],
		['label:"Tax 2026"', { kind: 'label', name: 'Tax 2026' }],
		['is:read', { kind: 'state', state: 'read' }],
		['is:unread', { kind: 'state', state: 'unread' }],
		['is:starred', { kind: 'state', state: 'starred' }],
		['after:2026-01-01', { kind: 'date', bound: 'after', at: midnight(2026, 1, 1, 1) }],
		['newer:2026/7/1', { kind: 'date', bound: 'after', at: midnight(2026, 7, 1, 2) }],
		['before:2026-01-01', { kind: 'date', bound: 'before', at: midnight(2026, 1, 1, 1) }],
		['older:2026-01-01', { kind: 'date', bound: 'before', at: midnight(2026, 1, 1, 1) }],
		['newer_than:7d', { kind: 'date', bound: 'after', at: SNAP.now - 7 * 86_400_000 }],
		['older_than:2m', { kind: 'date', bound: 'before', at: Date.UTC(2026, 8, 13, 11) }],
		['older_than:1y', { kind: 'date', bound: 'before', at: Date.UTC(2025, 10, 13, 12) }],
		['size:5000', { kind: 'size', op: 'gt', bytes: 5000 }],
		['larger:10K', { kind: 'size', op: 'gt', bytes: 10_000 }],
		['smaller:2MB', { kind: 'size', op: 'lt', bytes: 2_000_000 }],
		['deliveredto:Me@Thelemail.com', { kind: 'deliveredto', address: 'me@thelemail.com' }],
		['list:<News.Example.com>', { kind: 'list', value: 'news.example.com' }],
		['rfc822msgid:<AbC.123@mail.example>', { kind: 'msgid', id: 'AbC.123@mail.example' }],
		['rfc822msgid:AbC.123@mail.example', { kind: 'msgid', id: 'AbC.123@mail.example' }],
		['https://example.com/a', term('https://example.com/a', 'identifier')],
		['10:30', term('10:30', 'identifier')]
	];

	it.each(cases)('%s', (input, expected) => {
		expect(shape(input)).toEqual(expected);
	});
});

describe('parseQuery precedence', () => {
	const cases: [string, unknown][] = [
		['a b OR c d', or(and(term('a'), term('b')), and(term('c'), term('d')))],
		['a AND b OR c', or(and(term('a'), term('b')), term('c'))],
		['a AROUND 2 b c', and({ kind: 'around', left: term('a'), right: term('b'), distance: 2 }, term('c'))],
		['-a b', and(not(term('a')), term('b'))],
		['-a OR b', or(not(term('a')), term('b'))],
		['(a OR b) c', and(or(term('a'), term('b')), term('c'))],
		['from:x@y.z from:w@y.z', and(who('from', { kind: 'address', address: 'x@y.z' }), who('from', { kind: 'address', address: 'w@y.z' }))]
	];

	it.each(cases)('%s', (input, expected) => {
		expect(shape(input)).toEqual(expected);
	});
});

describe('parseQuery literals', () => {
	it('keeps quoted reserved words literal', () => {
		expect(shape('"OR"')).toEqual(phrase('or'));
		expect(shape('a "AND" b')).toEqual(and(term('a'), phrase('and'), term('b')));
		expect(shape('"a AROUND 3 b"')).toEqual(phrase('a around 3 b'));
	});

	it('keeps a quoted colon literal', () => {
		expect(shape('"from:alice"')).toEqual(phrase('from:alice'));
		expect(shape('"category:social"')).toEqual(phrase('category:social'));
	});

	it('keeps a hyphen inside an identifier', () => {
		expect(shape('INV-2026-0042')).toEqual(term('inv-2026-0042', 'identifier'));
		expect(shape('re-sign')).toEqual(term('re-sign', 'identifier'));
		expect(shape('a-')).toEqual(term('a-', 'identifier'));
		expect(shape('+AB-19/007')).toEqual({ kind: 'literal', text: 'ab-19/007', lane: 'identifier' });
	});

	it('unescapes quotes and backslashes inside quotes', () => {
		expect(shape('"say \\"hi\\" \\\\ now"')).toEqual(phrase('say "hi" \\ now'));
		expect(shape('"c:\\temp"')).toEqual(phrase('c:\\temp'));
	});

	it('returns no root for an empty query', () => {
		expect(ok('   ').root).toBeNull();
		expect(ok('').eligibility).toBe('words');
	});

	it('keeps typed nodes only and never echoes the raw query', () => {
		const query = ok('subject:(budget OR forecast) -from:newsletter@example.com');
		expect(JSON.stringify(query)).not.toContain('subject:(');
		expect(JSON.stringify(query)).not.toContain('from:');
	});

	it('records ranges into the input', () => {
		const root = ok('ab -cd').root;
		expect(root).toMatchObject({
			range: { start: 0, end: 6 },
			children: [{ range: { start: 0, end: 2 } }, { range: { start: 3, end: 6 }, child: { range: { start: 4, end: 6 } } }]
		});
	});
});

describe('parseQuery examples from the spec', () => {
	it('sender, date, phrase and trash exclusion', () => {
		const query = ok('from:alice@example.com after:2026-01-01 "service agreement" -in:trash');
		expect(bare(query.root)).toEqual(
			and(
				who('from', { kind: 'address', address: 'alice@example.com' }),
				{ kind: 'date', bound: 'after', at: midnight(2026, 1, 1, 1) },
				phrase('service agreement'),
				not({ kind: 'scope', scope: 'trash' })
			)
		);
		expect(query.universe).toEqual([]);
		expect(query.eligibility).toBe('words');
	});

	it('filename, attachment and label', () => {
		expect(shape('filename:pdf has:attachment label:"Tax 2026"')).toEqual(
			and({ kind: 'filename', text: 'pdf' }, { kind: 'has', value: 'attachment' }, { kind: 'label', name: 'Tax 2026' })
		);
	});

	it('scoped OR with a sender exclusion', () => {
		expect(shape('subject:(invoice OR receipt) -from:newsletter@example.com')).toEqual(
			and(
				{ kind: 'field', field: 'subject', child: or(term('invoice'), term('receipt')) },
				not(who('from', { kind: 'address', address: 'newsletter@example.com' }))
			)
		);
	});

	it('a punctuation-bearing literal', () => {
		expect(shape('+AB-19/007')).toEqual({ kind: 'literal', text: 'ab-19/007', lane: 'identifier' });
	});

	it('anywhere widens to spam and trash', () => {
		const query = ok('in:anywhere is:unread');
		expect(query.universe).toEqual(['spam', 'trash']);
	});

	it('drafts addressed to me', () => {
		expect(shape('in:drafts to:me')).toEqual(and({ kind: 'scope', scope: 'drafts' }, who('to', { kind: 'me' })));
	});

	it('meaning prose with a date', () => {
		const query = ok("the plumber's bathroom estimate after:2025-01-01");
		expect(query.eligibility).toBe('related');
	});

	it('meaning with a mandatory phrase and exclusion', () => {
		const query = ok('"Project Birch" renewal -from:bot@example.com');
		expect(query.eligibility).toBe('meaning');
	});
});

describe('parseQuery universe', () => {
	const cases: [string, string[]][] = [
		['invoice', []],
		['in:spam', ['spam']],
		['in:trash', ['trash']],
		['in:anywhere', ['spam', 'trash']],
		['-in:trash', []],
		['-in:anywhere', []],
		['from:alice OR in:spam', ['spam']],
		['-(-in:spam)', ['spam']],
		['-(in:spam OR x)', []],
		['subject:x -(in:trash -in:spam)', ['spam']]
	];

	it.each(cases)('%s', (input, expected) => {
		expect(ok(input).universe).toEqual(expected);
	});
});

describe('parseQuery eligibility', () => {
	const cases: [string, string][] = [
		['invoice', 'meaning'],
		['hotel invoice', 'related'],
		['(hotel invoice) budget', 'related'],
		['hotel invoice is:unread -from:bob@x.pt', 'related'],
		['hotel "exact phrase" +word', 'meaning'],
		['INV-2026', 'words'],
		['alice@example.com hotel', 'words'],
		['a OR b', 'words'],
		['{a b}', 'words'],
		['a AROUND 2 b', 'words'],
		['inv* hotel', 'words'],
		['-(a b) c', 'words'],
		['subject:budget plan', 'words'],
		['subject:"budget" plan', 'meaning'],
		['from:ali* plan', 'words'],
		['from:alice', 'words'],
		['"just a phrase"', 'words'],
		['is:unread', 'words']
	];

	it.each(cases)('%s', (input, expected) => {
		expect(ok(input).eligibility).toBe(expected);
	});
});

describe('parseQuery dates', () => {
	it('resolves midnight in the account time zone', () => {
		expect(shape('after:2026-03-29')).toEqual({ kind: 'date', bound: 'after', at: midnight(2026, 3, 29, 1) });
		expect(shape('after:2026-03-30')).toEqual({ kind: 'date', bound: 'after', at: midnight(2026, 3, 30, 2) });
	});

	it('takes the first valid instant when midnight falls in a gap', () => {
		const santiago = { ...SNAP, timeZone: 'America/Santiago' };
		expect(shape('after:2026-09-06', santiago)).toEqual({ kind: 'date', bound: 'after', at: Date.UTC(2026, 8, 6, 4) });
	});

	it('takes the earlier instant when midnight repeats', () => {
		const havana = { ...SNAP, timeZone: 'America/Havana' };
		expect(shape('before:2026-11-01', havana)).toEqual({ kind: 'date', bound: 'before', at: Date.UTC(2026, 10, 1, 4) });
	});

	it('clamps calendar subtraction to the last day of the month', () => {
		const end = { ...SNAP, now: Date.UTC(2026, 2, 31, 12) };
		expect(shape('older_than:1m', end)).toEqual({ kind: 'date', bound: 'before', at: Date.UTC(2026, 1, 28, 13) });
		const leap = { ...SNAP, now: Date.UTC(2028, 1, 29, 12) };
		expect(shape('newer_than:1y', leap)).toEqual({ kind: 'date', bound: 'after', at: Date.UTC(2027, 1, 28, 12) });
	});

	it('accepts a leap day and freezes the snapshot', () => {
		const query = ok('after:2028-02-29');
		expect(query.snapshot).toEqual(SNAP);
	});

	it('falls back to UTC for an unknown zone', () => {
		const query = ok('after:2026-01-01', { ...SNAP, timeZone: 'Mars/Olympus' });
		expect(query.snapshot.timeZone).toBe('UTC');
		expect(bare(query.root)).toEqual({ kind: 'date', bound: 'after', at: Date.UTC(2026, 0, 1) });
	});
});

describe('parseQuery limits', () => {
	it('accepts exactly 4096 bytes and rejects one more', () => {
		expect(ok('a'.repeat(4096)).root).not.toBeNull();
		expect(err('a'.repeat(4097))).toEqual({ code: 'too_long', range: { start: 4096, end: 4097 } });
	});

	it('counts bytes, not characters', () => {
		const input = `${'a'.repeat(4094)}é€`;
		expect(err(input)).toEqual({ code: 'too_long', range: { start: 4095, end: 4096 } });
	});

	it('accepts 128 nodes and rejects 129', () => {
		const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
		expect(ok(words(127)).root).not.toBeNull();
		const input = words(128);
		const at = input.lastIndexOf('w127');
		expect(err(input)).toEqual({ code: 'too_many_nodes', range: { start: at, end: at + 4 } });
	});

	it('accepts nesting depth 16 and rejects 17', () => {
		expect(ok(`${'('.repeat(16)}a${')'.repeat(16)}`).root).not.toBeNull();
		expect(err(`${'('.repeat(17)}a${')'.repeat(17)}`)).toEqual({ code: 'too_deep', range: { start: 16, end: 17 } });
		const nots = (n: number) => `${'-('.repeat(n)}a${')'.repeat(n)}`;
		expect(ok(nots(15)).root).not.toBeNull();
		expect(err(nots(16))).toMatchObject({ code: 'too_deep' });
	});

	it('accepts distance 1000 and rejects 1001', () => {
		expect(shape('a AROUND 1000 b')).toMatchObject({ distance: 1000 });
		expect(err('a AROUND 1001 b')).toEqual({ code: 'around_distance', range: { start: 9, end: 13 } });
	});
});

describe('parseQuery errors', () => {
	const cases: [string, QueryErrorCode, number, number, Partial<QueryError>?][] = [
		['"open', 'unterminated_quote', 0, 5],
		['a "b', 'unterminated_quote', 2, 4],
		['(a', 'unbalanced_paren', 0, 1],
		['a)', 'unbalanced_paren', 1, 2],
		['{a', 'unbalanced_paren', 0, 1],
		['(a}', 'unbalanced_paren', 2, 3],
		['()', 'empty_group', 0, 2],
		['{ }', 'empty_group', 0, 3],
		['""', 'empty_phrase', 0, 2],
		['OR a', 'dangling_operator', 0, 2],
		['a OR', 'dangling_operator', 2, 4],
		['a AND', 'dangling_operator', 2, 5],
		['a OR OR b', 'dangling_operator', 2, 4],
		['a - b', 'dangling_operator', 2, 3],
		['a -', 'dangling_operator', 2, 3],
		['AROUND 3 b', 'dangling_operator', 0, 6],
		['a AROUND 3', 'dangling_operator', 2, 8],
		['frm:alice', 'unsupported_filter', 0, 4, { name: 'frm:', hint: 'from:' }],
		['colour:red', 'unsupported_filter', 0, 7, { name: 'colour:', hint: undefined }],
		['category:social', 'gmail_only', 0, 9, { name: 'category:' }],
		['is:important', 'gmail_only', 0, 12, { name: 'is:important' }],
		['is:snoozed', 'gmail_only', 0, 10, { name: 'is:snoozed', hint: 'in:snoozed' }],
		['in:chats', 'gmail_only', 0, 8, { name: 'in:chats' }],
		['has:drive', 'gmail_only', 0, 9, { name: 'has:drive' }],
		['has:yellow-star', 'gmail_only', 0, 15, { name: 'has:yellow-star', hint: 'is:starred' }],
		['is:pinned', 'invalid_value', 0, 9, { name: 'is:' }],
		['has:pdf', 'invalid_value', 0, 7, { name: 'has:' }],
		['from:', 'missing_value', 0, 5, { name: 'from:' }],
		['from: alice', 'missing_value', 0, 5, { name: 'from:' }],
		['label:""', 'missing_value', 0, 8, { name: 'label:' }],
		['from:a@', 'invalid_value', 0, 7, { name: 'from:' }],
		['deliveredto:bob', 'invalid_value', 0, 15, { name: 'deliveredto:' }],
		['rfc822msgid:"a b"', 'invalid_value', 0, 17, { name: 'rfc822msgid:' }],
		['filetype:"a b"', 'invalid_value', 0, 14, { name: 'filetype:' }],
		['size:(1)', 'invalid_value', 5, 6, { name: 'size:' }],
		['after:2026-02-30', 'invalid_date', 0, 16, { name: 'after:' }],
		['before:yesterday', 'invalid_date', 0, 16, { name: 'before:' }],
		['newer_than:3w', 'invalid_relative', 0, 13, { name: 'newer_than:' }],
		['older_than:99999999d', 'invalid_relative', 0, 20, { name: 'older_than:' }],
		['size:12GB', 'invalid_size', 0, 9, { name: 'size:' }],
		['larger:-1', 'invalid_size', 0, 9, { name: 'larger:' }],
		['*voice', 'invalid_wildcard', 0, 6],
		['in*voice', 'invalid_wildcard', 0, 8],
		['i*', 'prefix_too_short', 0, 2],
		['from:a*', 'prefix_too_short', 0, 7],
		['a AROUND b c', 'around_distance', 2, 10],
		['a AROUND -1 b', 'around_distance', 2, 10],
		['from:x@y.z AROUND 2 b', 'around_operand', 0, 10],
		['a AROUND 2 bc*', 'around_operand', 11, 14],
		['a AROUND 2 b AROUND 2 c', 'around_operand', 0, 12],
		['+from:alice', 'literal_operand', 0, 11],
		['+inv*', 'literal_operand', 0, 5],
		['+(a)', 'literal_operand', 0, 2],
		['from:(alice +bob)', 'literal_operand', 12, 13],
		['subject:(a from:b)', 'nested_scope', 11, 17],
		['from:(is:read)', 'nested_scope', 6, 13]
	];

	it.each(cases)('%s → %s', (input, code, start, end, extra = {}) => {
		const error = err(input);
		expect(error).toMatchObject({ code, range: { start, end }, ...extra });
	});
});
