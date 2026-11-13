import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseQuery } from '../query';
import type { Grouping, QueryContext, Sort } from './compile';
import { Harness, SNAPSHOT, collect } from './harness';
import { referenceSearch, wordTokens } from './reference';
import type { QueryOptions } from './run';
import { Coverage, Dimension, Field, Flag, Role, SourceKind, type Attachment, type Participant, type Part, type SearchDocument } from './types';

const WORDS =
	'alpha beta gamma delta invoice receipt hotel flight budget forecast renewal contract review meeting agenda minutes café résumé naïve Zürich straße o\'neil plumber estimate bathroom'.split(
		' '
	);
const IDENTIFIERS = ['INV-2026-0042', 'AB-19/007', 'AB-19/0071', 'PO#5512', 'case_77', 'v2.4.1', 'build-7'];
const UNSEGMENTED = ['東京タワー', '東京', '京都', 'ソウル', '会議', 'สวัสดี'];
const PEOPLE: Participant[] = [
	{ role: Role.from, name: 'Ada Calloway', address: 'ada@calloway.test' },
	{ role: Role.from, name: 'Bram Calloway', address: 'bram@calloway.test' },
	{ role: Role.from, name: 'Cleo Marsh', address: 'cleo.marsh+billing@calloway.test' },
	{ role: Role.from, name: 'Newsletter', address: 'news@example.test' },
	{ role: Role.from, name: 'Dorian Ashby', address: 'dorian@ashby.test' },
	{ role: Role.from, name: '', address: 'ada.old@calloway.test' }
];
const FILES: Omit<Attachment, 'attachmentId' | 'size'>[] = [
	{ filename: 'statement-2026.pdf', mime: 'application/pdf' },
	{ filename: 'Budget Q3.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
	{ filename: 'notes.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
	{ filename: 'deck.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
	{ filename: 'logo.png', mime: 'image/png' },
	{ filename: 'photo.JPG', mime: 'image/jpeg' },
	{ filename: 'archive.7z', mime: 'application/x-7z-compressed' }
];
const FOLDERS = [
	{ id: 'f-projects', path: 'Projects' },
	{ id: 'f-invoices', path: 'Projects/Invoices' },
	{ id: 'f-personal', path: 'Personal' }
];
const LABELS = [
	{ id: 'l-tax', name: 'Tax 2026' },
	{ id: 'l-travel', name: 'Travel' },
	{ id: 'l-travel-2', name: 'travel' }
];
const DAY = 86_400_000;
const START = Date.UTC(2025, 6, 1);

function random(seed: number) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (n: number) => Math.floor(next() * n);
	const pick = <T>(list: readonly T[]): T => list[int(list.length)];
	const chance = (p: number) => next() < p;
	return { next, int, pick, chance };
}

type Random = ReturnType<typeof random>;

function sentence(r: Random, length: number): string {
	const out: string[] = [];
	for (let i = 0; i < length; i++) {
		const roll = r.next();
		if (roll < 0.06) out.push(r.pick(IDENTIFIERS));
		else if (roll < 0.09) out.push(r.pick(UNSEGMENTED));
		else if (roll < 0.11) out.push(r.pick(PEOPLE).address);
		else out.push(r.pick(WORDS));
	}
	return out.join(r.chance(0.2) ? ', ' : ' ');
}

function corpus(seed: number, size: number): SearchDocument[] {
	const r = random(seed);
	const docs: SearchDocument[] = [];
	for (let i = 0; i < size; i++) {
		const roll = r.next();
		const kind = roll < 0.82 ? SourceKind.message : roll < 0.94 ? SourceKind.draft : SourceKind.scheduled;
		const message = kind === SourceKind.message;
		let flags = 0;
		let known = 0;
		if (message) {
			known = r.chance(0.92) ? Flag.read | Flag.starred | Flag.inbox | Flag.archive | Flag.sent | Flag.spam | Flag.trash | Flag.snoozed : Flag.inbox;
			for (const bit of [Flag.read, Flag.starred, Flag.inbox, Flag.archive, Flag.sent, Flag.snoozed]) if (r.chance(0.35)) flags |= bit;
			if (r.chance(0.08)) flags |= Flag.spam;
			if (r.chance(0.08)) flags |= Flag.trash;
		}
		const participants: Participant[] = [{ ...r.pick(PEOPLE), role: Role.from }];
		for (let j = r.int(3); j >= 0; j--) participants.push({ ...r.pick(PEOPLE), role: r.pick([Role.to, Role.to, Role.cc, Role.bcc]) });
		if (r.chance(0.1)) participants.push({ role: Role.deliveredTo, name: '', address: r.pick(['alias@calloway.test', 'ada@calloway.test']) });
		const attachments: Attachment[] = [];
		const parts: Part[] = [{ field: Field.body, text: sentence(r, 4 + r.int(30)) }];
		if (r.chance(0.4)) parts.push({ field: Field.quoted, text: sentence(r, 3 + r.int(20)) });
		for (let j = r.chance(0.35) ? 1 + r.int(2) : 0; j > 0; j--) {
			const file = r.pick(FILES);
			const attachmentId = `a${j}`;
			attachments.push({ ...file, attachmentId, size: 100 + r.int(10_000), inline: file.mime.startsWith('image/') && r.chance(0.5) });
			if (r.chance(0.6)) {
				for (let page = 1; page <= 1 + r.int(2); page++) parts.push({ field: Field.attachmentText, attachmentId, locator: page, text: sentence(r, 3 + r.int(12)) });
			}
		}
		const coverage: SearchDocument['coverage'] = { [Dimension.metadata]: Coverage.complete, [Dimension.body]: Coverage.complete };
		if (r.chance(0.08)) coverage[Dimension.body] = r.pick([Coverage.pending, Coverage.failed, Coverage.processing]);
		if (attachments.length) coverage[Dimension.attachmentText] = r.pick([Coverage.complete, Coverage.complete, Coverage.failed, Coverage.excludedByUser, Coverage.locked]);
		const collections: SearchDocument['collections'] = [];
		if (message) {
			for (const f of FOLDERS) if (r.chance(0.12)) collections.push({ id: f.id, type: 'folder' });
			for (const l of LABELS) if (r.chance(0.15)) collections.push({ id: l.id, type: 'label' });
		}
		docs.push({
			kind,
			sourceId: `s${String(i).padStart(4, '0')}`,
			contentRevision: 1,
			metadataRevision: 1,
			threadId: message && r.chance(0.9) ? `t${r.int(Math.max(1, size / 3))}` : null,
			messageId: message ? `<${r.pick(['m', 'X', 'q'])}${i}.${r.int(99)}@mail.calloway.test>` : null,
			listId: r.chance(0.15) ? r.pick(['<Updates.Calloway.test>', 'news.example.test']) : null,
			date: START + r.int(400) * DAY + r.int(DAY),
			size: 500 + r.int(2_000_000),
			flags: attachments.some((a) => !a.inline) ? flags | Flag.attachments : flags,
			knownFlags: known,
			collections,
			subject: r.chance(0.95) ? sentence(r, 1 + r.int(6)) : null,
			participants,
			attachments,
			parts,
			coverage
		});
	}
	return docs;
}

function bodyPhrase(r: Random, docs: readonly SearchDocument[]): string {
	const words = r.pick(docs).parts[0].text.split(/[ ,]+/);
	const start = r.int(Math.max(1, words.length - 2));
	return words.slice(start, start + 2 + r.int(2)).join(' ');
}

function atom(r: Random, docs: readonly SearchDocument[]): string {
	const word = () => r.pick(WORDS);
	switch (r.int(30)) {
		case 0:
			return `"${bodyPhrase(r, docs)}"`;
		case 1:
			return `${word().slice(0, 2 + r.int(3))}*`;
		case 2:
			return r.pick(IDENTIFIERS);
		case 3:
			return `+${r.pick(IDENTIFIERS)}`;
		case 4:
			return `${word()} AROUND ${r.int(6)} ${r.chance(0.3) ? word() : `"${bodyPhrase(r, docs)}"`}`;
		case 5:
			return `${r.pick(['alpha', 'beta', 'budget'])} AROUND ${r.int(4)} ${r.pick(['alpha', 'beta', 'budget'])}`;
		case 6:
			return `${r.pick(['subject', 'body', 'attachment'])}:${word()}`;
		case 7:
			return `subject:(${word()} OR ${word()})`;
		case 8:
			return `${r.pick(['from', 'to', 'cc', 'bcc'])}:${r.pick(PEOPLE).address}`;
		case 9:
			return `${r.pick(['from', 'to'])}:me`;
		case 10:
			return `${r.pick(['from', 'to', 'cc'])}:${r.pick(['ada', 'calloway', 'cle*', 'marsh', '"Bram Calloway"'])}`;
		case 11:
			return `filename:${r.pick(['pdf', 'budget', 'q3.x', '7z', 'png', 'statement-2026'])}`;
		case 12:
			return `filetype:${r.pick(['pdf', 'docx', 'xlsx', 'image', 'document', 'spreadsheet', 'jpg', '7z'])}`;
		case 13:
			return `has:${r.pick(['attachment', 'image', 'document', 'spreadsheet', 'presentation', 'userlabels', 'nouserlabels'])}`;
		case 14:
			return `in:${r.pick(['inbox', 'sent', 'archive', 'snoozed', 'drafts', 'scheduled', 'spam', 'trash', 'anywhere', 'projects', '"Projects/Invoices"', 'personal'])}`;
		case 15:
			return `label:${r.pick(['"Tax 2026"', 'travel'])}`;
		case 16:
			return `is:${r.pick(['read', 'unread', 'starred'])}`;
		case 17:
			return `${r.pick(['after', 'before'])}:2026-${String(1 + r.int(12)).padStart(2, '0')}-${String(1 + r.int(28)).padStart(2, '0')}`;
		case 18:
			return `${r.pick(['newer_than', 'older_than'])}:${1 + r.int(12)}${r.pick(['d', 'm', 'y'])}`;
		case 19:
			return `${r.pick(['larger', 'smaller', 'size'])}:${r.pick(['1M', '500K', '20000', '1500000'])}`;
		case 20:
			return `deliveredto:${r.pick(['alias@calloway.test', 'ada@calloway.test'])}`;
		case 21:
			return `list:${r.pick(['updates.calloway.test', 'news.example.test', '<news.example.test>'])}`;
		case 22:
			return `rfc822msgid:${r.pick(docs).messageId ?? 'none@x.test'}`;
		case 23:
			return r.pick(UNSEGMENTED);
		case 24:
			return r.pick(['cafe', 'resume', 'zurich', 'strasse', "o'neil", 'naive']);
		default:
			return word();
	}
}

function query(r: Random, docs: readonly SearchDocument[], depth = 0): string {
	const n = 1 + r.int(depth ? 2 : 3);
	const parts: string[] = [];
	for (let i = 0; i < n; i++) {
		let part = depth < 2 && r.chance(0.15) ? `(${query(r, docs, depth + 1)})` : atom(r, docs);
		if (r.chance(0.2)) part = `-${part}`;
		parts.push(part);
	}
	return parts.join(r.chance(0.3) ? ' OR ' : ' ');
}

const SORTS: Sort[] = ['relevance', 'newest', 'oldest'];
const GROUPS: Grouping[] = ['thread', 'message'];
const STRATEGIES: NonNullable<QueryOptions['strategy']>[] = ['scan', 'candidates'];

function context(r: Random): QueryContext {
	return {
		identities: ['Ada@Calloway.test', 'ada.old@calloway.test'],
		folders: FOLDERS,
		labels: LABELS,
		attachmentText: r.chance(0.8)
	};
}

describe.each([
	{ seed: 11, size: 260, queries: 220 },
	{ seed: 2026, size: 320, queries: 220 }
])('differential against the reference (seed $seed)', ({ seed, size, queries }) => {
	const docs = corpus(seed, size);
	const h = new Harness();

	beforeAll(async () => {
		await h.call({ op: 'memory' });
		await h.call({ op: 'putBatch', docs });
	});

	afterAll(() => h.terminate());

	it('tokenizes the corpus the way the index does', async () => {
		await h.call({ op: 'exec', sql: 'CREATE VIRTUAL TABLE IF NOT EXISTS temp.ref_vocab USING fts5vocab (main, parts_fts, row)' });
		const vocab = new Map((await h.select<[string, number]>('SELECT term, cnt FROM temp.ref_vocab')).map(([t, c]) => [t, c]));
		const expected = new Map<string, number>();
		const add = (text: string) => {
			for (const t of wordTokens(text)) expected.set(t, (expected.get(t) ?? 0) + 1);
		};
		for (const d of docs) {
			if (d.subject) add(d.subject);
			for (const p of d.participants) if (p.role !== Role.deliveredTo) add(p.name ? `${p.name} ${p.address}` : p.address);
			for (const a of d.attachments) add(a.filename);
			for (const p of d.parts) add(p.text);
		}
		expect(vocab).toEqual(expected);
	});

	it('returns the same membership, counts, coverage and order for random queries', async () => {
		const r = random(seed * 7919);
		let checked = 0;
		let nonEmpty = 0;
		for (let i = 0; i < queries; i++) {
			const input = query(r, docs);
			const parsed = parseQuery(input, SNAPSHOT);
			if (!parsed.ok) continue;
			const ctx = context(r);
			const options = { sort: r.pick(SORTS), group: r.pick(GROUPS), strategy: r.pick(STRATEGIES) };
			const got = await collect(h, input, ctx, options);
			const want = referenceSearch(docs, parsed.query, ctx, options);
			const label = `${input} ${JSON.stringify(options)} attachments=${ctx.attachmentText}`;
			expect(got.summary.matches, label).toBe(want.matches);
			expect(got.summary.groups, label).toBe(want.groups.length);
			expect([got.summary.incomplete, got.summary.excluded], label).toEqual([want.incomplete, want.excluded]);
			expect(got.groups, label).toEqual(want.groups);
			checked++;
			if (want.matches) nonEmpty++;
		}
		expect(checked).toBeGreaterThan(queries * 0.9);
		expect(nonEmpty).toBeGreaterThan(checked * 0.4);
	});

	it('returns identical results for both evaluation strategies', async () => {
		const r = random(seed * 104729);
		for (let i = 0; i < 40; i++) {
			const input = `${atom(r, docs)} ${atom(r, docs)}`;
			if (!parseQuery(input, SNAPSHOT).ok) continue;
			const ctx = context(r);
			const scan = await collect(h, input, ctx, { sort: 'relevance', group: 'thread', strategy: 'scan' });
			const candidates = await collect(h, input, ctx, { sort: 'relevance', group: 'thread', strategy: 'candidates' });
			expect({ ...candidates.summary, id: 0 }, input).toEqual({ ...scan.summary, id: 0 });
			expect(candidates.groups, input).toEqual(scan.groups);
		}
	});
});
