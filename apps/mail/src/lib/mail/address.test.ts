import { describe, it, expect } from 'vitest';
import { parseAddressList, parseMailbox, sanitizeDisplayName, splitAddressList } from './address';
import { isEmail } from './data';

describe('parseMailbox', () => {
	it('splits name and address in the RFC 5322 form', () => {
		expect(parseMailbox('Victor Hugo <victor@example.com>')).toEqual({
			name: 'Victor Hugo',
			address: 'victor@example.com'
		});
	});

	it('unquotes a display name containing a comma', () => {
		expect(parseMailbox('"Bob, Jr." <b@x.com>')).toEqual({
			name: 'Bob, Jr.',
			address: 'b@x.com'
		});
	});

	it('accepts an angle-only mailbox', () => {
		expect(parseMailbox('<a@x.com>')).toEqual({ name: '', address: 'a@x.com' });
	});

	it('keeps a bare address unchanged', () => {
		expect(parseMailbox('  a@x.com  ')).toEqual({ name: '', address: 'a@x.com' });
	});

	it('unescapes quotes and backslashes inside a quoted name', () => {
		expect(parseMailbox('"Vlad \\"V\\" Gorokhov\\\\" <v@x.com>')).toEqual({
			name: 'Vlad "V" Gorokhov\\',
			address: 'v@x.com'
		});
	});

	it('keeps an unquoted name that contains a quote', () => {
		expect(parseMailbox('Vlad "V" Gorokhov <v@x.com>')).toEqual({
			name: 'Vlad "V" Gorokhov',
			address: 'v@x.com'
		});
	});

	it('strips control characters from a display name', () => {
		const m = parseMailbox('"Vlad\r\nBcc: evil@x.com" <v@x.com>');
		expect(m.address).toBe('v@x.com');
		expect(m.name).not.toMatch(/[\r\n]/);
		expect(m.name).toBe('VladBcc: evil@x.com');
	});

	it('unfolds a header continuation line', () => {
		expect(parseMailbox('Victor Hugo\r\n <vlad@x.com>')).toEqual({
			name: 'Victor Hugo',
			address: 'vlad@x.com'
		});
	});

	it('leaves a string that is not an address invalid', () => {
		const m = parseMailbox('not an address');
		expect(m).toEqual({ name: '', address: 'not an address' });
		expect(isEmail(m.address)).toBe(false);
	});

	it('treats an unbalanced angle bracket as invalid', () => {
		const m = parseMailbox('Vlad <vlad@x.com');
		expect(isEmail(m.address)).toBe(false);
	});

	it('caps a very long display name', () => {
		const m = parseMailbox(`"${'a'.repeat(400)}" <v@x.com>`);
		expect(m.name.length).toBe(255);
	});
});

describe('splitAddressList', () => {
	it('splits on separators outside quotes and angle brackets', () => {
		expect(splitAddressList('Alice <a@x.com>, "Bob, Jr." <b@x.com>; c@x.com')).toEqual([
			'Alice <a@x.com>',
			'"Bob, Jr." <b@x.com>',
			'c@x.com'
		]);
	});

	it('ignores separators inside angle brackets', () => {
		expect(splitAddressList('<a,b@x.com>')).toEqual(['<a,b@x.com>']);
	});

	it('drops empty segments', () => {
		expect(splitAddressList(' a@x.com ,, ; b@x.com,')).toEqual(['a@x.com', 'b@x.com']);
	});

	it('splits a newline-separated paste', () => {
		expect(splitAddressList('a@x.com\nb@x.com')).toEqual(['a@x.com', 'b@x.com']);
	});
});

describe('parseAddressList', () => {
	it('parses multiple pasted recipients', () => {
		expect(parseAddressList('Alice <a@x.com>, "Bob, Jr." <b@x.com>')).toEqual([
			{ name: 'Alice', address: 'a@x.com' },
			{ name: 'Bob, Jr.', address: 'b@x.com' }
		]);
	});

	it('mixes valid and invalid entries', () => {
		const list = parseAddressList('Alice <a@x.com>, nonsense');
		expect(list.map((m) => isEmail(m.address))).toEqual([true, false]);
	});

	it('returns nothing for blank input', () => {
		expect(parseAddressList('   ')).toEqual([]);
	});
});

describe('sanitizeDisplayName', () => {
	it('turns tabs into spaces and removes other control characters', () => {
		expect(sanitizeDisplayName('a\tb\u0000c\u007fd')).toBe('a bcd');
	});
});
