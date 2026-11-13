import type { BindValue } from '@thelemail/sqlite-wasm';
import type {
	HasValue,
	ParsedQuery,
	ParticipantRole,
	ParticipantValue,
	QueryError,
	QueryNode,
	Range,
	StateValue,
	SystemScope,
	TextField,
	WidenedScope
} from '../query/ast';
import { codePoints, foldText } from '../query/text';
import { hasUnsegmented } from './analysis';
import { Coverage, Dimension, Field, Flag, Role, SourceKind } from './types';
import { COLLECTION_TYPE } from './writer';

export type Sort = 'relevance' | 'newest' | 'oldest';
export type Grouping = 'thread' | 'message';

export interface QueryContext {
	identities: readonly string[];
	folders: readonly { id: string; path: string }[];
	labels: readonly { id: string; name: string }[];
	attachmentText: boolean;
}

export const WEIGHTS: Readonly<Record<Field, number>> = {
	[Field.subject]: 4,
	[Field.participant]: 3,
	[Field.body]: 1,
	[Field.quoted]: 0.35,
	[Field.attachmentName]: 3,
	[Field.attachmentText]: 1,
	[Field.identifier]: 3
};

export const DIMENSION_OF: Readonly<Record<Field, Dimension>> = {
	[Field.subject]: Dimension.metadata,
	[Field.participant]: Dimension.metadata,
	[Field.body]: Dimension.body,
	[Field.quoted]: Dimension.body,
	[Field.attachmentName]: Dimension.attachmentMetadata,
	[Field.attachmentText]: Dimension.attachmentText,
	[Field.identifier]: Dimension.metadata
};

export const ROLE_OF: Readonly<Record<ParticipantRole, Role>> = {
	from: Role.from,
	to: Role.to,
	cc: Role.cc,
	bcc: Role.bcc
};

const SCOPED_FIELDS: Readonly<Record<TextField, readonly Field[]>> = {
	subject: [Field.subject],
	body: [Field.body, Field.quoted],
	attachment: [Field.attachmentText]
};

export const FAMILIES: Readonly<Record<'document' | 'spreadsheet' | 'presentation', readonly string[]>> = {
	document: [
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'application/vnd.oasis.opendocument.text',
		'application/rtf',
		'text/rtf',
		'text/plain',
		'application/vnd.apple.pages'
	],
	spreadsheet: [
		'application/vnd.ms-excel',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'application/vnd.oasis.opendocument.spreadsheet',
		'text/csv',
		'application/vnd.apple.numbers'
	],
	presentation: [
		'application/vnd.ms-powerpoint',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		'application/vnd.oasis.opendocument.presentation',
		'application/vnd.apple.keynote'
	]
};

export const EXTENSION_MIMES: Readonly<Record<string, readonly string[]>> = {
	pdf: ['application/pdf'],
	doc: ['application/msword'],
	docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
	odt: ['application/vnd.oasis.opendocument.text'],
	rtf: ['application/rtf', 'text/rtf'],
	txt: ['text/plain'],
	xls: ['application/vnd.ms-excel'],
	xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
	ods: ['application/vnd.oasis.opendocument.spreadsheet'],
	csv: ['text/csv'],
	ppt: ['application/vnd.ms-powerpoint'],
	pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
	odp: ['application/vnd.oasis.opendocument.presentation'],
	jpg: ['image/jpeg'],
	jpeg: ['image/jpeg'],
	png: ['image/png'],
	gif: ['image/gif'],
	webp: ['image/webp'],
	heic: ['image/heic'],
	svg: ['image/svg+xml'],
	zip: ['application/zip'],
	ics: ['text/calendar'],
	eml: ['message/rfc822']
};

export const IMAGE_MIME = 'image/%';

export interface Fragment {
	sql: string;
	params: BindValue[];
}

export interface Near {
	left: string;
	right: string;
	distance: number;
}

export type Step =
	| {
			kind: 'fts';
			table: 'parts_fts' | 'literals_fts';
			match: string;
			fields: Field[];
			role: Role | null;
			verify: string | null;
			near: Near | null;
	  }
	| { kind: 'msgid'; match: string; needle: string }
	| { kind: 'scan'; needle: string; fields: Field[] };

export interface Leaf {
	steps: Step[];
	exact: boolean;
	positive: boolean;
	dims: Dimension[];
}

export type Expr =
	| { kind: 'leaf'; leaf: number }
	| { kind: 'meta'; sql: string; params: BindValue[]; known: Fragment | null }
	| { kind: 'and' | 'or'; children: Expr[] }
	| { kind: 'not'; child: Expr }
	| { kind: 'const'; value: boolean };

export interface Suggestible {
	text: string;
	range: Range;
}

export interface Plan {
	leaves: Leaf[];
	expr: Expr;
	filters: Expr[];
	universe: WidenedScope[];
	suggestible: Suggestible[];
}

export type CompileResult = { ok: true; plan: Plan } | { ok: false; error: QueryError };

class CompileError extends Error {
	constructor(readonly error: QueryError) {
		super(error.code);
	}
}

export function quote(text: string): string {
	return `"${text.replaceAll('"', '""')}"`;
}

function placeholders(n: number): string {
	return Array.from({ length: n }, () => '?').join(', ');
}

function hasTokens(text: string): boolean {
	return /[\p{L}\p{N}]/u.test(text);
}

function unique<T>(values: Iterable<T>): T[] {
	return [...new Set(values)];
}

export function bareFields(ctx: QueryContext): Field[] {
	const fields: Field[] = [Field.subject, Field.participant, Field.body, Field.quoted, Field.attachmentName];
	if (ctx.attachmentText) fields.push(Field.attachmentText);
	return fields;
}

function meta(sql: string, params: BindValue[], known: Fragment | null = null): Expr {
	return { kind: 'meta', sql, params, known };
}

const NONE: Expr = { kind: 'const', value: false };
const ALL: Expr = { kind: 'const', value: true };

function flagMeta(bit: number, set: boolean): Expr {
	return meta(
		`(s.kind = ? AND s.known_flags & ? != 0 AND s.flags & ? ${set ? '!=' : '='} 0)`,
		[SourceKind.message, bit, bit],
		{ sql: '(s.kind != ? OR s.known_flags & ? != 0)', params: [SourceKind.message, bit] }
	);
}

function attachmentMeta(where: string, params: BindValue[]): Expr {
	return meta(`s.id IN (SELECT source FROM attachments WHERE ${where})`, params);
}

function familyMimes(value: string): readonly string[] | null {
	return Object.hasOwn(FAMILIES, value) ? FAMILIES[value as keyof typeof FAMILIES] : null;
}

function scopeMeta(scope: SystemScope): Expr {
	switch (scope) {
		case 'inbox':
			return flagMeta(Flag.inbox, true);
		case 'sent':
			return flagMeta(Flag.sent, true);
		case 'archive':
			return flagMeta(Flag.archive, true);
		case 'snoozed':
			return flagMeta(Flag.snoozed, true);
		case 'spam':
			return flagMeta(Flag.spam, true);
		case 'trash':
			return flagMeta(Flag.trash, true);
		case 'drafts':
			return meta('s.kind = ?', [SourceKind.draft]);
		case 'scheduled':
			return meta('s.kind = ?', [SourceKind.scheduled]);
		case 'anywhere':
			return ALL;
	}
}

function stateMeta(state: StateValue): Expr {
	switch (state) {
		case 'read':
			return flagMeta(Flag.read, true);
		case 'unread':
			return flagMeta(Flag.read, false);
		case 'starred':
			return flagMeta(Flag.starred, true);
	}
}

function hasMeta(value: HasValue): Expr {
	switch (value) {
		case 'attachment':
			return attachmentMeta('inline = 0', []);
		case 'image':
			return attachmentMeta('lower(mime) LIKE ?', [IMAGE_MIME]);
		case 'document':
		case 'spreadsheet':
		case 'presentation': {
			const mimes = FAMILIES[value];
			return attachmentMeta(`lower(mime) IN (${placeholders(mimes.length)})`, [...mimes]);
		}
		case 'userlabels':
			return meta('s.id IN (SELECT source FROM collections WHERE type = ?)', [COLLECTION_TYPE.label]);
		case 'nouserlabels':
			return meta('s.id NOT IN (SELECT source FROM collections WHERE type = ?)', [COLLECTION_TYPE.label]);
	}
}

function filetypeMeta(value: string): Expr {
	const clauses = ['tl_ext(filename) = ?'];
	const params: BindValue[] = [value];
	const mimes = unique([...(EXTENSION_MIMES[value] ?? []), ...(familyMimes(value) ?? [])]);
	if (mimes.length) {
		clauses.push(`lower(mime) IN (${placeholders(mimes.length)})`);
		params.push(...mimes);
	}
	if (value === 'image') {
		clauses.push('lower(mime) LIKE ?');
		params.push(IMAGE_MIME);
	}
	return attachmentMeta(clauses.join(' OR '), params);
}

function participantMeta(role: Role, addresses: readonly string[]): Expr {
	if (!addresses.length) return NONE;
	return meta(`s.id IN (SELECT source FROM participants WHERE role = ? AND address IN (${placeholders(addresses.length)}))`, [
		role,
		...addresses
	]);
}

function collectionMeta(ids: readonly string[]): Expr {
	return meta(`s.id IN (SELECT source FROM collections WHERE collection_id IN (${placeholders(ids.length)}))`, [...ids]);
}

function dimsOf(fields: readonly Field[]): Dimension[] {
	return unique(fields.map((f) => DIMENSION_OF[f])).sort((a, b) => a - b);
}

class Compiler {
	readonly leaves: Leaf[] = [];
	readonly suggestible: Suggestible[] = [];
	readonly #ctx: QueryContext;
	readonly #bare: Field[];

	constructor(ctx: QueryContext) {
		this.#ctx = ctx;
		this.#bare = bareFields(ctx);
	}

	#leaf(steps: Step[], fields: readonly Field[], exact: boolean, positive: boolean): Expr {
		this.leaves.push({ steps, exact, positive, dims: dimsOf(fields) });
		return { kind: 'leaf', leaf: this.leaves.length - 1 };
	}

	#fts(match: string, fields: Field[], extra: Partial<Extract<Step, { kind: 'fts' }>> = {}): Step {
		return { kind: 'fts', table: 'parts_fts', match, fields, role: null, verify: null, near: null, ...extra };
	}

	#unsegmented(text: string, fields: Field[], positive: boolean): Expr {
		const step: Step =
			codePoints(text) >= 3
				? this.#fts(quote(text), fields, { table: 'literals_fts' })
				: { kind: 'scan', needle: text, fields };
		return this.#leaf([step], fields, false, positive);
	}

	#text(text: string, lane: 'word' | 'identifier', fields: Field[] | null, positive: boolean, range: Range, literal: boolean): Expr {
		const scope = fields ?? this.#bare;
		if (!hasTokens(text)) return NONE;
		if (hasUnsegmented(text)) return this.#unsegmented(text, scope, positive);
		if (lane === 'identifier') {
			const steps: Step[] = [this.#fts(quote(text), scope, { verify: text })];
			if (fields === null && codePoints(text) >= 3) steps.push({ kind: 'msgid', match: quote(text), needle: text });
			return this.#leaf(steps, fields === null ? [...scope, Field.identifier] : scope, true, positive);
		}
		if (positive && !literal) this.suggestible.push({ text, range });
		return this.#leaf([this.#fts(quote(text), scope)], scope, false, positive);
	}

	#participant(role: ParticipantRole, value: ParticipantValue, positive: boolean): Expr {
		const r = ROLE_OF[role];
		switch (value.kind) {
			case 'me':
				return participantMeta(r, unique(this.#ctx.identities.map((a) => foldText(a.trim()))));
			case 'address':
				return participantMeta(r, [value.address]);
			case 'name': {
				if (!hasTokens(value.text)) return NONE;
				const match = value.prefix ? `${quote(value.text)} *` : quote(value.text);
				return this.#leaf([this.#fts(match, [Field.participant], { role: r })], [Field.participant], false, positive);
			}
		}
	}

	#folder(path: string, range: Range): Expr {
		const target = foldText(path);
		const ids = this.#ctx.folders.filter((f) => {
			const p = foldText(f.path);
			return p === target || p.startsWith(`${target}/`);
		});
		if (!ids.length) throw new CompileError({ code: 'unknown_folder', range, name: path });
		return collectionMeta(unique(ids.map((f) => f.id)));
	}

	#label(name: string, range: Range): Expr {
		const target = foldText(name);
		const ids = this.#ctx.labels.filter((l) => foldText(l.name) === target);
		if (!ids.length) throw new CompileError({ code: 'unknown_label', range, name });
		return collectionMeta(unique(ids.map((l) => l.id)));
	}

	compile(node: QueryNode, fields: Field[] | null, positive: boolean): Expr {
		switch (node.kind) {
			case 'and':
			case 'or': {
				const children = node.children.flatMap((c) => {
					const e = this.compile(c, fields, positive);
					return e.kind === node.kind ? e.children : [e];
				});
				return { kind: node.kind, children };
			}
			case 'not':
				return { kind: 'not', child: this.compile(node.child, fields, !positive) };
			case 'field':
				return this.compile(node.child, [...SCOPED_FIELDS[node.field]], positive);
			case 'term':
				return this.#text(node.text, node.lane, fields, positive, node.range, false);
			case 'literal':
				return this.#text(node.text, node.lane, fields, positive, node.range, true);
			case 'phrase': {
				const scope = fields ?? this.#bare;
				if (!hasTokens(node.text)) return NONE;
				if (hasUnsegmented(node.text) && !/\s/u.test(node.text)) return this.#unsegmented(node.text, scope, positive);
				return this.#leaf([this.#fts(quote(node.text), scope)], scope, false, positive);
			}
			case 'prefix': {
				const scope = fields ?? this.#bare;
				if (!hasTokens(node.text)) return NONE;
				if (hasUnsegmented(node.text)) return this.#unsegmented(node.text, scope, positive);
				return this.#leaf([this.#fts(`${quote(node.text)} *`, scope)], scope, false, positive);
			}
			case 'around': {
				const scope = fields ?? this.#bare;
				if (!hasTokens(node.left.text) || !hasTokens(node.right.text)) return NONE;
				const distance = Math.trunc(node.distance);
				const match = `NEAR(${quote(node.left.text)} ${quote(node.right.text)}, ${distance})`;
				const near = { left: node.left.text, right: node.right.text, distance };
				return this.#leaf([this.#fts(match, scope, { near })], scope, false, positive);
			}
			case 'participant':
				return this.#participant(node.role, node.value, positive);
			case 'filename':
				return attachmentMeta('instr(tl_fold(filename), ?) > 0', [node.text]);
			case 'filetype':
				return filetypeMeta(node.text);
			case 'has':
				return hasMeta(node.value);
			case 'scope':
				return scopeMeta(node.scope);
			case 'folder':
				return this.#folder(node.path, node.range);
			case 'label':
				return this.#label(node.name, node.range);
			case 'state':
				return stateMeta(node.state);
			case 'date':
				return node.bound === 'after' ? meta('s.date >= ?', [node.at]) : meta('s.date < ?', [node.at]);
			case 'size':
				return node.op === 'gt' ? meta('s.size > ?', [node.bytes]) : meta('s.size < ?', [node.bytes]);
			case 'deliveredto':
				return participantMeta(Role.deliveredTo, [node.address]);
			case 'list':
				return meta('s.list_id IS ?', [node.value]);
			case 'msgid':
				return meta('(s.message_id IS ? OR s.message_id IS ?)', [node.id, `<${node.id}>`]);
		}
	}
}

export function containsLeaf(expr: Expr): boolean {
	switch (expr.kind) {
		case 'leaf':
			return true;
		case 'and':
		case 'or':
			return expr.children.some(containsLeaf);
		case 'not':
			return containsLeaf(expr.child);
		default:
			return false;
	}
}

export function compile(query: ParsedQuery, ctx: QueryContext): CompileResult {
	const compiler = new Compiler(ctx);
	try {
		const expr = query.root ? compiler.compile(query.root, null, true) : ALL;
		const conjuncts = expr.kind === 'and' ? expr.children : [expr];
		return {
			ok: true,
			plan: {
				leaves: compiler.leaves,
				expr,
				filters: conjuncts.filter((c) => !containsLeaf(c)),
				universe: query.universe,
				suggestible: compiler.suggestible
			}
		};
	} catch (err) {
		if (err instanceof CompileError) return { ok: false, error: err.error };
		throw err;
	}
}

function coverageKnown(dims: readonly Dimension[]): Fragment {
	return {
		sql: `NOT EXISTS (SELECT 1 FROM coverage c WHERE c.source = s.id AND c.dimension IN (${placeholders(dims.length)}) AND c.state != ?)`,
		params: [...dims, Coverage.complete]
	};
}

export function render(expr: Expr, plan: Plan, table: (leaf: number) => string): Fragment {
	switch (expr.kind) {
		case 'const':
			return { sql: expr.value ? '1' : '0', params: [] };
		case 'leaf':
			return { sql: `s.id IN (SELECT source FROM ${table(expr.leaf)})`, params: [] };
		case 'meta':
			return { sql: expr.sql, params: expr.params };
		case 'and':
		case 'or': {
			const parts = expr.children.map((c) => render(c, plan, table));
			return {
				sql: `(${parts.map((p) => p.sql).join(expr.kind === 'and' ? ' AND ' : ' OR ')})`,
				params: parts.flatMap((p) => p.params)
			};
		}
		case 'not': {
			const child = render(expr.child, plan, table);
			const known = knownOf(expr.child, plan);
			return { sql: `(NOT ${child.sql} AND ${known.sql})`, params: [...child.params, ...known.params] };
		}
	}
}

export function knownOf(expr: Expr, plan: Plan): Fragment {
	const parts: Fragment[] = [];
	const visit = (e: Expr) => {
		switch (e.kind) {
			case 'leaf':
				parts.push(coverageKnown(plan.leaves[e.leaf].dims));
				break;
			case 'meta':
				if (e.known) parts.push(e.known);
				break;
			case 'and':
			case 'or':
				e.children.forEach(visit);
				break;
			case 'not':
				visit(e.child);
				break;
		}
	};
	visit(expr);
	if (!parts.length) return { sql: '1', params: [] };
	return { sql: `(${parts.map((p) => p.sql).join(' AND ')})`, params: parts.flatMap((p) => p.params) };
}

export function universeOf(plan: Plan): Fragment {
	let mask = Flag.spam | Flag.trash;
	if (plan.universe.includes('spam')) mask &= ~Flag.spam;
	if (plan.universe.includes('trash')) mask &= ~Flag.trash;
	if (!mask) return { sql: '1', params: [] };
	return { sql: '(s.kind != ? OR s.flags & ? = 0)', params: [SourceKind.message, mask] };
}

export function usedDimensions(plan: Plan): Dimension[] {
	return unique(plan.leaves.flatMap((l) => l.dims)).sort((a, b) => a - b);
}

export function coverageFragments(dims: readonly Dimension[]): { incomplete: Fragment; excluded: Fragment } {
	const list = placeholders(dims.length);
	return {
		incomplete: {
			sql: `EXISTS (SELECT 1 FROM coverage c WHERE c.source = s.id AND c.dimension IN (${list}) AND c.state NOT IN (?, ?))`,
			params: [...dims, Coverage.complete, Coverage.excludedByUser]
		},
		excluded: {
			sql: `EXISTS (SELECT 1 FROM coverage c WHERE c.source = s.id AND c.dimension IN (${list}) AND c.state = ?)`,
			params: [...dims, Coverage.excludedByUser]
		}
	};
}
