import { describe, expect, it } from 'vitest';
import {
	collectionResolver,
	excerptFor,
	matchesPreview,
	NO_COLLECTIONS,
	planPreview,
	scoreText,
	type CollectionResolver,
	type PreviewPlan
} from './preview';
import { parseQuery } from './query';
import type { IndexedRow, IndexedText } from './types';

const SNAPSHOT = { now: Date.UTC(2026, 10, 13), timeZone: 'UTC' };

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

function row(over: Partial<IndexedRow> = {}): IndexedRow {
	return {
		accountId: 'acc-1',
		id: 'm1',
		chunkId: 0,
		storedAt: Date.UTC(2026, 5, 1),
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

function plan(input: string, collections: CollectionResolver = NO_COLLECTIONS): PreviewPlan {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok || !parsed.query.root) throw new Error(input);
	const planned = planPreview(parsed.query.root, parsed.query.universe, collections);
	if (!planned.ok) throw new Error(`${input}: ${planned.error.code}`);
	return planned.plan;
}

function hit(input: string, r: IndexedRow, t: IndexedText = text(), collections?: CollectionResolver): boolean {
	return matchesPreview(plan(input, collections), r, t);
}

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

	it('scores a word start higher than a mid-word hit', () => {
		expect(scoreText(text({ subject: 'invoice' }), ['inv'])).toBeGreaterThan(
			scoreText(text({ subject: 'reinvoice' }), ['inv'])
		);
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
		expect(excerptFor(text({ subject: 'Invoice', snippet: 'nothing' }), ['invoice'])).toBe('nothing');
	});
});

describe('matchesPreview text', () => {
	const record = text({ subject: 'Invoice 42', snippet: 'due friday', senderDisplay: 'Anna Reis', senderAddress: 'anna@school.pt' });

	it('requires every word somewhere', () => {
		expect(hit('invoice friday', row(), record)).toBe(true);
		expect(hit('invoice monday', row(), record)).toBe(false);
	});

	it('unions OR and braces', () => {
		expect(hit('monday OR friday', row(), record)).toBe(true);
		expect(hit('{monday tuesday}', row(), record)).toBe(false);
	});

	it('excludes a negated word', () => {
		expect(hit('invoice -friday', row(), record)).toBe(false);
		expect(hit('invoice -monday', row(), record)).toBe(true);
	});

	it('limits subject: to the subject', () => {
		expect(hit('subject:invoice', row(), record)).toBe(true);
		expect(hit('subject:friday', row(), record)).toBe(false);
		expect(hit('subject:(friday OR 42)', row(), record)).toBe(true);
	});

	it('ignores diacritics on both sides', () => {
		expect(hit('reuniao', row(), text({ subject: 'Reunião da escola' }))).toBe(true);
		expect(hit('reunião', row(), text({ subject: 'Reuniao' }))).toBe(true);
	});

	it('matches a prefix and a phrase', () => {
		expect(hit('inv*', row(), record)).toBe(true);
		expect(hit('"due friday"', row(), record)).toBe(true);
		expect(hit('"friday due"', row(), record)).toBe(false);
	});
});

describe('matchesPreview participants', () => {
	const sender = text({ senderDisplay: 'Anna Reis', senderAddress: 'anna@school.pt', recipients: 'Bob bob@x.pt' });

	it('matches a sender name fragment and an exact address', () => {
		expect(hit('from:reis', row(), sender)).toBe(true);
		expect(hit('from:anna@school.pt', row(), sender)).toBe(true);
		expect(hit('from:nna@school.pt', row(), sender)).toBe(false);
		expect(hit('from:bob', row(), sender)).toBe(false);
	});

	it('matches recipients for to: and cc:', () => {
		expect(hit('to:bob', row(), sender)).toBe(true);
		expect(hit('cc:bob@x.pt', row(), sender)).toBe(true);
		expect(hit('to:anna', row(), sender)).toBe(false);
	});

	it('reads from:me as mail this account sent', () => {
		expect(hit('from:me', row({ direction: 'sent' }), sender)).toBe(true);
		expect(hit('from:me', row({ direction: 'received' }), sender)).toBe(false);
	});

	it('ignores diacritics in names', () => {
		expect(hit('from:renee', row(), text({ senderDisplay: 'Renée', senderAddress: 'r@x.pt' }))).toBe(true);
	});
});

describe('matchesPreview scopes and state', () => {
	it('separates sent from inbox even though both are the inbox mailbox', () => {
		const received = row({ direction: 'received', mailboxState: 'inbox' });
		const sent = row({ direction: 'sent', mailboxState: 'inbox' });
		expect(hit('in:inbox', received)).toBe(true);
		expect(hit('in:inbox', sent)).toBe(false);
		expect(hit('in:sent', sent)).toBe(true);
		expect(hit('in:sent', received)).toBe(false);
	});

	it('files a sent message in its mailbox once it leaves the inbox', () => {
		const archived = row({ direction: 'sent', mailboxState: 'archive' });
		expect(hit('in:archive', archived)).toBe(true);
		expect(hit('in:sent', archived)).toBe(false);
	});

	it('keeps spam and trash out unless the query asks for them', () => {
		const spam = row({ mailboxState: 'spam', read: false });
		const trash = row({ mailboxState: 'trash', read: false });
		expect(hit('is:unread', spam)).toBe(false);
		expect(hit('is:unread', trash)).toBe(false);
		expect(hit('-in:trash', trash)).toBe(false);
		expect(hit('-in:trash', spam)).toBe(false);
		expect(hit('in:spam', spam)).toBe(true);
		expect(hit('in:anywhere is:unread', spam)).toBe(true);
		expect(hit('in:anywhere is:unread', trash)).toBe(true);
		expect(hit('in:spam OR is:unread', trash)).toBe(false);
		expect(hit('in:spam OR is:unread', row({ read: false }))).toBe(true);
	});

	it('applies read, starred, attachment and label presence', () => {
		expect(hit('is:unread', row({ read: false }))).toBe(true);
		expect(hit('is:unread', row({ read: true }))).toBe(false);
		expect(hit('is:read', row({ read: true }))).toBe(true);
		expect(hit('is:starred', row({ starred: true }))).toBe(true);
		expect(hit('-is:starred', row({ starred: true }))).toBe(false);
		expect(hit('has:attachment', row({ attachmentCount: 2 }))).toBe(true);
		expect(hit('has:attachment', row())).toBe(false);
		expect(hit('has:userlabels', row({ labels: ['l1'] }))).toBe(true);
		expect(hit('has:nouserlabels', row({ labels: ['l1'] }))).toBe(false);
		expect(hit('has:nouserlabels', row())).toBe(true);
	});

	it('bounds dates inclusively from after: and exclusively before before:', () => {
		const midnight = row({ storedAt: Date.UTC(2026, 0, 1) });
		expect(hit('after:2026-01-01', midnight)).toBe(true);
		expect(hit('before:2026-01-01', midnight)).toBe(false);
		expect(hit('before:2026-01-02', midnight)).toBe(true);
		expect(hit('newer_than:7d', row({ storedAt: SNAPSHOT.now - 6 * 86_400_000 }))).toBe(true);
		expect(hit('newer_than:7d', row({ storedAt: SNAPSHOT.now - 8 * 86_400_000 }))).toBe(false);
	});
});

describe('folder and label operators', () => {
	const folders = [
		{ id: 'f-clients', name: 'Clients', path: 'Clients' },
		{ id: 'f-acme', name: 'Acme', path: 'Clients / Acme' },
		{ id: 'f-home', name: 'Receipts', path: 'Home / Receipts' },
		{ id: 'f-work', name: 'Receipts', path: 'Work / Receipts' }
	];
	const labels = [
		{ id: 'l-work', name: 'Work', path: 'Work' },
		{ id: 'l-urgent', name: 'Urgent', path: 'Work / Urgent' },
		{ id: 'l-tax', name: 'Tax', path: 'Tax' }
	];
	const children: Record<string, string[]> = { 'f-clients': ['f-acme'], 'l-work': ['l-urgent'] };
	const subtree = (id: string) => [id, ...(children[id] ?? [])];
	const resolver = collectionResolver(folders, labels, subtree);

	it('resolves a folder by name or path and includes its subfolders', () => {
		expect(resolver.folder('clients')).toEqual(['f-clients', 'f-acme']);
		expect(resolver.folder('Clients/Acme')).toEqual(['f-acme']);
		expect(resolver.folder('receipts')).toEqual(['f-home', 'f-work']);
		expect(resolver.folder('work / receipts')).toEqual(['f-work']);
		expect(resolver.folder('nowhere')).toBeNull();
	});

	it('matches only mail filed in the folder subtree', () => {
		expect(hit('in:clients', row({ mailboxState: 'folder', folderId: 'f-acme' }), text(), resolver)).toBe(true);
		expect(hit('in:clients', row({ mailboxState: 'folder', folderId: 'f-home' }), text(), resolver)).toBe(false);
		expect(hit('in:clients', row({ mailboxState: 'trash', folderId: 'f-acme' }), text(), resolver)).toBe(false);
	});

	it('requires every label on the same message, each with its sublabels', () => {
		expect(hit('label:work label:tax', row({ labels: ['l-urgent', 'l-tax'] }), text(), resolver)).toBe(true);
		expect(hit('label:work label:tax', row({ labels: ['l-urgent'] }), text(), resolver)).toBe(false);
	});

	it('combines a folder, a label and flags', () => {
		const filed = row({ mailboxState: 'folder', folderId: 'f-acme', labels: ['l-work'], read: false });
		expect(hit('label:Work in:"Clients/Acme" is:unread', filed, text(), resolver)).toBe(true);
		expect(hit('label:Work in:"Clients/Acme" is:unread', { ...filed, read: true }, text(), resolver)).toBe(false);
	});
});
