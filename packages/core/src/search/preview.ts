import type { QueryError, QueryNode, WidenedScope } from './query/ast';
import { childrenOf } from './query/walk';
import type { IndexedRow, IndexedText } from './types';

const WEIGHT_SUBJECT = 10;
const WEIGHT_SENDER = 6;
const WEIGHT_RECIPIENTS = 3;
const WEIGHT_SNIPPET = 2;
const EXCERPT_RADIUS = 60;

export function fold(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

export interface CollectionResolver {
	folder(name: string): string[] | null;
	label(name: string): string[] | null;
}

export const NO_COLLECTIONS: CollectionResolver = { folder: () => null, label: () => null };

interface NamedCollection {
	id: string;
	name: string;
	path: string;
}

function pathKey(value: string): string {
	return fold(value)
		.split('/')
		.map((part) => part.trim())
		.filter(Boolean)
		.join('/');
}

export function collectionResolver(
	folders: readonly NamedCollection[],
	labels: readonly NamedCollection[],
	subtree: (id: string) => readonly string[]
): CollectionResolver {
	const lookup = (entries: readonly NamedCollection[]) => (name: string) => {
		const wanted = pathKey(name);
		if (!wanted) return null;
		const hits = entries.filter(
			(e) => pathKey(e.path) === wanted || (!wanted.includes('/') && pathKey(e.name) === wanted)
		);
		if (!hits.length) return null;
		return [...new Set(hits.flatMap((e) => subtree(e.id)))];
	};
	return { folder: lookup(folders), label: lookup(labels) };
}

export interface PreviewPlan {
	root: QueryNode;
	universe: readonly WidenedScope[];
	collections: Map<QueryNode, string[]>;
	needles: Map<QueryNode, string>;
	terms: string[];
}

export type PreviewPlanResult = { ok: true; plan: PreviewPlan } | { ok: false; error: QueryError };

class Unavailable extends Error {
	readonly error: QueryError;

	constructor(error: QueryError) {
		super(error.code);
		this.error = error;
	}
}

function unavailable(node: QueryNode): never {
	throw new Unavailable({ code: 'unavailable', range: node.range });
}

function check(node: QueryNode): void {
	switch (node.kind) {
		case 'field':
			if (node.field !== 'subject') unavailable(node);
			break;
		case 'participant':
			if (node.role === 'bcc') unavailable(node);
			if (node.value.kind === 'me' && node.role !== 'from') unavailable(node);
			break;
		case 'has':
			if (!['attachment', 'userlabels', 'nouserlabels'].includes(node.value)) unavailable(node);
			break;
		case 'scope':
			if (node.scope === 'drafts' || node.scope === 'scheduled') unavailable(node);
			break;
		case 'around':
		case 'filename':
		case 'filetype':
		case 'size':
		case 'deliveredto':
		case 'list':
		case 'msgid':
			unavailable(node);
	}
}

export function planPreview(
	root: QueryNode,
	universe: readonly WidenedScope[],
	collections: CollectionResolver
): PreviewPlanResult {
	const plan: PreviewPlan = {
		root,
		universe,
		collections: new Map(),
		needles: new Map(),
		terms: []
	};
	const visit = (node: QueryNode, positive: boolean) => {
		check(node);
		if (node.kind === 'folder' || node.kind === 'label') {
			const ids = node.kind === 'folder' ? collections.folder(node.path) : collections.label(node.name);
			if (!ids) {
				const name = node.kind === 'folder' ? node.path : node.name;
				throw new Unavailable({ code: node.kind === 'folder' ? 'unknown_folder' : 'unknown_label', range: node.range, name });
			}
			plan.collections.set(node, ids);
		}
		if (node.kind === 'term' || node.kind === 'phrase' || node.kind === 'literal' || node.kind === 'prefix') {
			const needle = fold(node.text);
			plan.needles.set(node, needle);
			if (positive && needle && !plan.terms.includes(needle)) plan.terms.push(needle);
		}
		if (node.kind === 'participant' && node.value.kind !== 'me') {
			plan.needles.set(node, fold(node.value.kind === 'address' ? node.value.address : node.value.text));
		}
		const polarity = node.kind === 'not' ? !positive : positive;
		for (const child of childrenOf(node)) visit(child, polarity);
	};
	try {
		visit(root, true);
	} catch (err) {
		if (err instanceof Unavailable) return { ok: false, error: err.error };
		throw err;
	}
	return { ok: true, plan };
}

type Mailbox = 'inbox' | 'sent' | 'archive' | 'spam' | 'trash' | 'snoozed' | 'folder';

function mailboxOf(row: IndexedRow): Mailbox {
	if (row.mailboxState === 'folder') return 'folder';
	if (row.mailboxState === 'archive') return 'archive';
	if (row.mailboxState === 'trash') return 'trash';
	if (row.mailboxState === 'spam') return 'spam';
	if (row.mailboxState === 'snoozed') return 'snoozed';
	return row.direction === 'sent' ? 'sent' : 'inbox';
}

interface Haystack {
	subject: string;
	sender: string;
	senderAddress: string;
	recipients: string;
	snippet: string;
}

function haystackFor(text: IndexedText): Haystack {
	return {
		subject: fold(text.subject),
		sender: fold(`${text.senderDisplay} ${text.senderAddress}`),
		senderAddress: fold(text.senderAddress),
		recipients: fold(text.recipients),
		snippet: fold(text.snippet)
	};
}

function evaluate(plan: PreviewPlan, node: QueryNode, row: IndexedRow, hay: Haystack, subjectOnly: boolean): boolean {
	switch (node.kind) {
		case 'and':
			return node.children.every((child) => evaluate(plan, child, row, hay, subjectOnly));
		case 'or':
			return node.children.some((child) => evaluate(plan, child, row, hay, subjectOnly));
		case 'not':
			return !evaluate(plan, node.child, row, hay, subjectOnly);
		case 'field':
			return evaluate(plan, node.child, row, hay, true);
		case 'term':
		case 'phrase':
		case 'literal':
		case 'prefix': {
			const needle = plan.needles.get(node) ?? '';
			if (subjectOnly) return hay.subject.includes(needle);
			return [hay.subject, hay.sender, hay.recipients, hay.snippet].some((field) => field.includes(needle));
		}
		case 'participant': {
			if (node.value.kind === 'me') return row.direction === 'sent';
			const needle = plan.needles.get(node) ?? '';
			if (node.role === 'from') {
				return node.value.kind === 'address' ? hay.senderAddress === needle : hay.sender.includes(needle);
			}
			return hay.recipients.includes(needle);
		}
		case 'state':
			if (node.state === 'starred') return row.starred;
			return node.state === 'read' ? row.read : !row.read;
		case 'has':
			if (node.value === 'attachment') return row.attachmentCount > 0;
			if (node.value === 'userlabels') return row.labels.length > 0;
			return row.labels.length === 0;
		case 'scope':
			return node.scope === 'anywhere' || mailboxOf(row) === node.scope;
		case 'folder': {
			const ids = plan.collections.get(node) ?? [];
			return row.mailboxState === 'folder' && !!row.folderId && ids.includes(row.folderId);
		}
		case 'label': {
			const ids = plan.collections.get(node) ?? [];
			return ids.some((id) => row.labels.includes(id));
		}
		case 'date':
			return node.bound === 'after' ? row.storedAt >= node.at : row.storedAt < node.at;
		default:
			return false;
	}
}

export function matchesPreview(plan: PreviewPlan, row: IndexedRow, text: IndexedText): boolean {
	const mailbox = mailboxOf(row);
	if ((mailbox === 'spam' || mailbox === 'trash') && !plan.universe.includes(mailbox)) return false;
	return evaluate(plan, plan.root, row, haystackFor(text), false);
}

function fieldScore(field: string, term: string): number {
	if (!field) return 0;
	const at = field.indexOf(term);
	if (at < 0) return 0;
	const before = at === 0 ? '' : field[at - 1];
	return before === '' || !/[\p{L}\p{N}]/u.test(before) ? 1 : 0.5;
}

export function scoreText(text: IndexedText, terms: readonly string[]): number {
	if (!terms.length) return 0;
	const hay = haystackFor(text);
	let total = 0;
	for (const term of terms) {
		total += Math.max(
			fieldScore(hay.subject, term) * WEIGHT_SUBJECT,
			fieldScore(hay.sender, term) * WEIGHT_SENDER,
			fieldScore(hay.recipients, term) * WEIGHT_RECIPIENTS,
			fieldScore(hay.snippet, term) * WEIGHT_SNIPPET
		);
	}
	return total;
}

export function excerptFor(text: IndexedText, terms: readonly string[]): string {
	const source = text.snippet || text.subject;
	if (!source || !terms.length) return text.snippet;
	const normalized = fold(source);
	let at = -1;
	for (const term of terms) {
		const found = normalized.indexOf(term);
		if (found >= 0 && (at < 0 || found < at)) at = found;
	}
	if (at < 0) return text.snippet;
	const start = Math.max(0, at - EXCERPT_RADIUS);
	const end = Math.min(source.length, at + EXCERPT_RADIUS);
	const head = start > 0 ? '…' : '';
	const tail = end < source.length ? '…' : '';
	return `${head}${source.slice(start, end).trim()}${tail}`;
}
