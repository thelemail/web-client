import { describe, it, expect } from 'vitest';
import { queryMatches } from './match';
import type { Message } from './data';
import { DEFAULT_QUERY, type Query } from './url';

function msg(overrides: Partial<Message> = {}): Message {
	return {
		id: 'm1',
		folder: 'inbox',
		direction: 'received',
		from: 'Sender',
		fromAddr: 'sender@example.com',
		to: 'me@example.com',
		init: 'S',
		bg: '',
		fg: '',
		subj: 'Subject',
		labels: [],
		unread: false,
		starred: false,
		prev: '',
		body: [],
		epoch: 0,
		...overrides
	};
}

function query(overrides: Partial<Query> = {}): Query {
	return { ...DEFAULT_QUERY, ...overrides };
}

describe('queryMatches', () => {
	it('matches on folder equality', () => {
		expect(queryMatches(query({ folder: 'inbox' }), msg({ folder: 'inbox' }))).toBe(true);
		expect(queryMatches(query({ folder: 'inbox' }), msg({ folder: 'archive' }))).toBe(false);
	});

	it('starred pseudo-folder requires starred and excludes trash/spam', () => {
		const q = query({ folder: 'starred' });
		expect(queryMatches(q, msg({ folder: 'inbox', starred: true }))).toBe(true);
		expect(queryMatches(q, msg({ folder: 'archive', starred: true }))).toBe(true);
		expect(queryMatches(q, msg({ folder: 'inbox', starred: false }))).toBe(false);
		expect(queryMatches(q, msg({ folder: 'trash', starred: true }))).toBe(false);
		expect(queryMatches(q, msg({ folder: 'spam', starred: true }))).toBe(false);
	});

	it('gates on unread', () => {
		const q = query({ folder: 'inbox', unread: true });
		expect(queryMatches(q, msg({ unread: true }))).toBe(true);
		expect(queryMatches(q, msg({ unread: false }))).toBe(false);
	});

	it('gates on attachments', () => {
		const q = query({ folder: 'inbox', attach: true });
		expect(queryMatches(q, msg({ attachments: [{ name: 'a', size: '1kb' }] }))).toBe(true);
		expect(queryMatches(q, msg({ attachments: [] }))).toBe(false);
		expect(queryMatches(q, msg({}))).toBe(false);
	});

	it('labels use any-of intersection semantics', () => {
		const q = query({ folder: 'inbox', labels: ['domains', 'family'] });
		expect(queryMatches(q, msg({ labels: ['domains'] }))).toBe(true);
		expect(queryMatches(q, msg({ labels: ['family'] }))).toBe(true);
		expect(queryMatches(q, msg({ labels: ['security'] }))).toBe(false);
		expect(queryMatches(q, msg({ labels: [] }))).toBe(false);
	});

	it('no labels filter matches regardless of message labels', () => {
		const q = query({ folder: 'inbox', labels: [] });
		expect(queryMatches(q, msg({ labels: ['security'] }))).toBe(true);
	});
});
