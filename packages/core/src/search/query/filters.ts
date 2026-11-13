import {
	fail,
	type HasValue,
	type ParticipantRole,
	type QueryNode,
	type QuerySnapshot,
	type Range,
	type StateValue,
	type SystemScope,
	type TextField
} from './ast';
import { absoluteDate, relativeDate } from './dates';
import { asciiLower } from './lexer';
import { codePoints, foldText, isAddress } from './text';
import { normalize } from '../sqlite/analysis';

export type FilterDef =
	| { kind: 'field'; field: TextField }
	| { kind: 'participant'; role: ParticipantRole }
	| { kind: 'filename' }
	| { kind: 'filetype' }
	| { kind: 'has' }
	| { kind: 'in' }
	| { kind: 'label' }
	| { kind: 'is' }
	| { kind: 'date'; bound: 'after' | 'before' }
	| { kind: 'relative'; bound: 'after' | 'before' }
	| { kind: 'size'; op: 'gt' | 'lt' }
	| { kind: 'deliveredto' }
	| { kind: 'list' }
	| { kind: 'msgid' };

export const FILTERS: Readonly<Record<string, FilterDef>> = {
	subject: { kind: 'field', field: 'subject' },
	body: { kind: 'field', field: 'body' },
	attachment: { kind: 'field', field: 'attachment' },
	from: { kind: 'participant', role: 'from' },
	to: { kind: 'participant', role: 'to' },
	cc: { kind: 'participant', role: 'cc' },
	bcc: { kind: 'participant', role: 'bcc' },
	filename: { kind: 'filename' },
	filetype: { kind: 'filetype' },
	has: { kind: 'has' },
	in: { kind: 'in' },
	label: { kind: 'label' },
	is: { kind: 'is' },
	after: { kind: 'date', bound: 'after' },
	newer: { kind: 'date', bound: 'after' },
	before: { kind: 'date', bound: 'before' },
	older: { kind: 'date', bound: 'before' },
	newer_than: { kind: 'relative', bound: 'after' },
	older_than: { kind: 'relative', bound: 'before' },
	size: { kind: 'size', op: 'gt' },
	larger: { kind: 'size', op: 'gt' },
	smaller: { kind: 'size', op: 'lt' },
	deliveredto: { kind: 'deliveredto' },
	list: { kind: 'list' },
	rfc822msgid: { kind: 'msgid' }
};

const GMAIL_NAMES: Readonly<Record<string, string | undefined>> = {
	category: undefined,
	smartlabel: undefined
};

const SCOPES: readonly SystemScope[] = [
	'inbox',
	'sent',
	'archive',
	'snoozed',
	'drafts',
	'scheduled',
	'spam',
	'trash',
	'anywhere'
];

const HAS: readonly HasValue[] = [
	'attachment',
	'document',
	'spreadsheet',
	'presentation',
	'image',
	'userlabels',
	'nouserlabels'
];

const STATES: readonly StateValue[] = ['read', 'unread', 'starred'];

const GMAIL_IS: Readonly<Record<string, string | undefined>> = {
	important: undefined,
	muted: undefined,
	chat: undefined,
	snoozed: 'in:snoozed'
};

const GMAIL_IN: Readonly<Record<string, string | undefined>> = {
	chats: undefined,
	important: undefined
};

const GMAIL_HAS: Readonly<Record<string, string | undefined>> = {
	drive: undefined,
	youtube: undefined
};

const GMAIL_MARK = /^(?:yellow|orange|red|purple|blue|green)-(?:star|bang|guillemet|check|info|question)$|^(?:red-bang|orange-guillemet|yellow-bang|green-check|blue-info|purple-question)$/;

const SIZE = /^(\d{1,15})(k|m)?b?$/i;
const FILETYPE = /^[\p{L}\p{N}][\p{L}\p{N}+._-]*$/u;

export function lookupFilter(name: string): FilterDef | null {
	const key = asciiLower(name);
	return Object.hasOwn(FILTERS, key) ? FILTERS[key] : null;
}

function distance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i += 1) {
		let prev = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const next = row[j];
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = next;
		}
	}
	return row[b.length];
}

function nearestFilter(name: string): string | undefined {
	let best: string | undefined;
	let bestScore = 3;
	for (const candidate of Object.keys(FILTERS)) {
		const score = distance(name, candidate);
		if (score < bestScore) {
			best = candidate;
			bestScore = score;
		}
	}
	return best === undefined ? undefined : `${best}:`;
}

export function rejectUnknown(name: string, range: Range): never {
	const key = asciiLower(name);
	if (Object.hasOwn(GMAIL_NAMES, key)) fail('gmail_only', range, { name: `${key}:`, hint: GMAIL_NAMES[key] });
	fail('unsupported_filter', range, { name: `${name}:`, hint: nearestFilter(key) });
}

function pick<T extends string>(
	name: string,
	value: string,
	range: Range,
	allowed: readonly T[],
	gmail: Readonly<Record<string, string | undefined>>
): T {
	const key = asciiLower(value);
	if ((allowed as readonly string[]).includes(key)) return key as T;
	if (Object.hasOwn(gmail, key)) fail('gmail_only', range, { name: `${name}:${key}`, hint: gmail[key] });
	fail('invalid_value', range, { name: `${name}:` });
}

function hasValue(value: string, range: Range): HasValue {
	const key = asciiLower(value);
	if (GMAIL_MARK.test(key)) fail('gmail_only', range, { name: `has:${key}`, hint: 'is:starred' });
	return pick('has', value, range, HAS, GMAIL_HAS);
}

function stripAngles(value: string): string {
	return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
}

function address(name: string, value: string, range: Range): string {
	const folded = foldText(value.trim());
	if (!isAddress(folded)) fail('invalid_value', range, { name: `${name}:` });
	return folded;
}

export function participantValue(
	role: ParticipantRole,
	value: string,
	quoted: boolean,
	range: Range
): QueryNode {
	const trimmed = value.trim();
	if (!trimmed) fail('missing_value', range, { name: `${role}:` });
	if (!quoted && asciiLower(trimmed) === 'me') return { kind: 'participant', role, value: { kind: 'me' }, range };
	if (trimmed.includes('@')) {
		return { kind: 'participant', role, value: { kind: 'address', address: address(role, trimmed, range) }, range };
	}
	const prefix = !quoted && trimmed.endsWith('*');
	const text = foldText(prefix ? trimmed.slice(0, -1) : trimmed);
	if (!quoted && text.includes('*')) fail('invalid_wildcard', range);
	if (prefix && codePoints(text) < 2) fail('prefix_too_short', range);
	return { kind: 'participant', role, value: { kind: 'name', text, prefix }, range };
}

export type ScalarFilter = Exclude<FilterDef, { kind: 'field' | 'participant' }>;

export function scalarValue(
	name: string,
	def: ScalarFilter,
	value: string,
	range: Range,
	snapshot: QuerySnapshot
): QueryNode {
	const trimmed = value.trim();
	const label = `${asciiLower(name)}:`;
	if (!trimmed) fail('missing_value', range, { name: label });
	switch (def.kind) {
		case 'filename':
			return { kind: 'filename', text: foldText(trimmed), range };
		case 'filetype': {
			const text = foldText(trimmed).replace(/^\./, '');
			if (!FILETYPE.test(text)) fail('invalid_value', range, { name: label });
			return { kind: 'filetype', text, range };
		}
		case 'has':
			return { kind: 'has', value: hasValue(trimmed, range), range };
		case 'in': {
			const key = asciiLower(trimmed);
			if ((SCOPES as readonly string[]).includes(key)) return { kind: 'scope', scope: key as SystemScope, range };
			if (Object.hasOwn(GMAIL_IN, key)) fail('gmail_only', range, { name: `in:${key}`, hint: GMAIL_IN[key] });
			return { kind: 'folder', path: normalize(trimmed), range };
		}
		case 'label':
			return { kind: 'label', name: normalize(trimmed), range };
		case 'is':
			return { kind: 'state', state: pick('is', trimmed, range, STATES, GMAIL_IS), range };
		case 'date': {
			const at = absoluteDate(trimmed, snapshot.timeZone);
			if (at === null) fail('invalid_date', range, { name: label });
			return { kind: 'date', bound: def.bound, at, range };
		}
		case 'relative': {
			const at = relativeDate(trimmed, snapshot.now, snapshot.timeZone);
			if (at === null) fail('invalid_relative', range, { name: label });
			return { kind: 'date', bound: def.bound, at, range };
		}
		case 'size': {
			const match = SIZE.exec(trimmed);
			if (!match) fail('invalid_size', range, { name: label });
			const unit = match[2] ? asciiLower(match[2]) : '';
			const bytes = Number(match[1]) * (unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : 1);
			if (!Number.isSafeInteger(bytes)) fail('invalid_size', range, { name: label });
			return { kind: 'size', op: def.op, bytes, range };
		}
		case 'deliveredto':
			return { kind: 'deliveredto', address: address('deliveredto', trimmed, range), range };
		case 'list': {
			const text = foldText(stripAngles(trimmed));
			if (!text) fail('missing_value', range, { name: label });
			return { kind: 'list', value: text, range };
		}
		case 'msgid': {
			const id = normalize(stripAngles(trimmed));
			if (!id || /\s/u.test(id)) fail('invalid_value', range, { name: label });
			return { kind: 'msgid', id, range };
		}
	}
}
