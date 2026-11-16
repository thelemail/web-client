import PostalMime, { type Address, type Email } from 'postal-mime';
import { charsetDecodable, enableIconvFallback, mayNeedIconv } from '../../mail/render/textDecoderPolyfill';
import { Field, Role, type Part, type Participant } from '../sqlite/types';
import { htmlToText } from './html';
import { regions } from './regions';

export const EXTRACTOR_EPOCH = 1;

type DraftFields = Partial<Record<'v' | 'from' | 'to' | 'cc' | 'bcc' | 'subject' | 'bodyHtml' | 'bodyText' | 'attachments', unknown>>;

export const Warning = {
	charset: 1 << 0,
	replacement: 1 << 1,
	truncated: 1 << 2
} as const;

export interface ExtractLimits {
	maxText: number;
	maxParts: number;
	maxDepth: number;
	maxAttachments: number;
}

export const LIMITS: ExtractLimits = {
	maxText: 4 * 1024 * 1024,
	maxParts: 512,
	maxDepth: 3,
	maxAttachments: 256
};

export type ExtractRequest = { kind: 'mime'; bytes: Uint8Array } | { kind: 'draft'; bytes: Uint8Array };

export interface ExtractedAttachment {
	attachmentId: string;
	filename: string;
	mime: string;
	size: number;
	inline: boolean;
}

export type Outcome = 'complete' | 'resource_limited' | 'malformed';

export interface Extracted {
	outcome: Outcome;
	subject: string | null;
	participants: Participant[];
	parts: Part[];
	attachments: ExtractedAttachment[];
	messageId: string | null;
	listId: string | null;
	warnings: number;
}

const WORD = /[\p{L}\p{N}]+/gu;
const CHARSET = /charset\s*=\s*"?([A-Za-z0-9_\-:.]+)"?/gi;
const HEAD_SCAN = 256 * 1024;

class Collector {
	parts: Part[] = [];
	warnings = 0;
	limited = false;
	#text = 0;
	#limits: ExtractLimits;

	constructor(limits: ExtractLimits) {
		this.#limits = limits;
	}

	add(field: Field, text: string, locator: number): void {
		if (this.limited || !text) return;
		if (text.includes('�')) this.warnings |= Warning.replacement;
		if (this.parts.length >= this.#limits.maxParts) {
			this.#truncate();
			return;
		}
		const room = this.#limits.maxText - this.#text;
		if (text.length > room) {
			if (room > 0) this.parts.push({ field, text: text.slice(0, room), locator });
			this.#text = this.#limits.maxText;
			this.#truncate();
			return;
		}
		this.#text += text.length;
		this.parts.push({ field, text, locator });
	}

	body(text: string, locator: number): void {
		for (const r of regions(text)) this.add(r.field, r.text, locator);
	}

	#truncate(): void {
		this.limited = true;
		this.warnings |= Warning.truncated;
	}
}

function mailboxes(list: readonly Address[] | Address | undefined): { name: string; address: string }[] {
	if (!list) return [];
	const out: { name: string; address: string }[] = [];
	for (const a of Array.isArray(list) ? list : [list]) {
		if (a.group) for (const m of a.group) out.push({ name: m.name ?? '', address: m.address ?? '' });
		else if (a.address) out.push({ name: a.name ?? '', address: a.address });
	}
	return out.filter((m) => m.address.length > 0);
}

function participantsOf(email: Email): Participant[] {
	const out: Participant[] = [];
	const push = (role: Role, list: readonly Address[] | Address | undefined) => {
		for (const m of mailboxes(list)) out.push({ role, name: m.name, address: m.address });
	};
	push(Role.from, email.from);
	push(Role.sender, email.sender);
	push(Role.to, email.to);
	push(Role.cc, email.cc);
	push(Role.bcc, email.bcc);
	push(Role.replyTo, email.replyTo);
	return out;
}

function header(email: Email, key: string): string | null {
	const h = email.headers.find((x) => x.key === key);
	return h ? h.value.trim() || null : null;
}

function words(text: string): Set<string> {
	return new Set(Array.from(text.toLowerCase().matchAll(WORD), (m) => m[0]));
}

function addsWords(extra: string, base: string): boolean {
	const known = words(base);
	for (const w of words(extra)) if (!known.has(w)) return true;
	return false;
}

function charsetWarnings(bytes: Uint8Array): { iconv: boolean; unknown: boolean } {
	const head = new TextDecoder('latin1').decode(bytes.subarray(0, HEAD_SCAN));
	let iconv = false;
	const labels: string[] = [];
	for (const m of head.matchAll(CHARSET)) {
		labels.push(m[1]);
		if (mayNeedIconv(m[1])) iconv = true;
	}
	return { iconv, unknown: labels.some((l) => !charsetDecodable(l)) };
}

function byteLength(content: ArrayBuffer | Uint8Array | string): number {
	if (typeof content === 'string') return new TextEncoder().encode(content).length;
	return content.byteLength;
}

function contentBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
	if (typeof content === 'string') return new TextEncoder().encode(content);
	return content instanceof Uint8Array ? content : new Uint8Array(content);
}

export async function parseMime(bytes: Uint8Array): Promise<Email> {
	if (charsetWarnings(bytes).iconv) await enableIconvFallback().catch(() => undefined);
	return parse(bytes);
}

async function parse(bytes: Uint8Array): Promise<Email> {
	const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return PostalMime.parse(input, { forceRfc822Attachments: true, attachmentEncoding: 'arraybuffer', maxNestingDepth: 64 });
}

function textOf(email: Email): { text: string; html: string | null } {
	const html = email.html ? htmlToText(email.html) : null;
	const text = email.text?.trim() ? email.text : '';
	return { text, html };
}

export async function extractMime(bytes: Uint8Array, limits: ExtractLimits = LIMITS): Promise<Extracted> {
	const charsets = charsetWarnings(bytes);
	if (charsets.iconv) await enableIconvFallback().catch(() => undefined);
	const after = charsetWarnings(bytes);
	let email: Email;
	try {
		email = await parse(bytes);
	} catch {
		return { outcome: 'malformed', subject: null, participants: [], parts: [], attachments: [], messageId: null, listId: null, warnings: 0 };
	}
	const c = new Collector(limits);
	if (after.unknown) c.warnings |= Warning.charset;
	let locator = 0;
	const attachments: ExtractedAttachment[] = [];
	const nested: Uint8Array[] = [];

	const visit = (msg: Email, depth: number) => {
		const own = locator++;
		const { text, html } = textOf(msg);
		if (depth > 0) {
			if (msg.subject) c.add(Field.body, msg.subject, own);
			const people = participantsOf(msg)
				.map((p) => (p.name ? `${p.name} <${p.address}>` : p.address))
				.join(', ');
			if (people) c.add(Field.body, people, own);
		}
		if (text) c.body(text, own);
		if (html && (!text || addsWords(html, text))) c.body(html, text ? locator++ : own);
		for (const a of msg.attachments) {
			const mime = (a.mimeType || 'application/octet-stream').toLowerCase();
			if (depth === 0 && attachments.length < limits.maxAttachments) {
				attachments.push({
					attachmentId: `mime:${attachments.length}`,
					filename: a.filename ?? '',
					mime,
					size: byteLength(a.content),
					inline: a.disposition === 'inline' || a.related === true
				});
			} else if (depth === 0) {
				c.limited = true;
			}
			if (mime === 'message/rfc822' || mime === 'message/global') nested.push(contentBytes(a.content));
		}
	};

	visit(email, 0);
	const queue = nested.splice(0).map((b) => ({ bytes: b, depth: 1 }));
	while (queue.length > 0 && !c.limited) {
		const next = queue.shift()!;
		if (next.depth > limits.maxDepth) {
			c.limited = true;
			break;
		}
		let inner: Email;
		try {
			inner = await parse(next.bytes);
		} catch {
			continue;
		}
		visit(inner, next.depth);
		for (const b of nested.splice(0)) queue.push({ bytes: b, depth: next.depth + 1 });
	}

	return {
		outcome: c.limited ? 'resource_limited' : 'complete',
		subject: email.subject ?? null,
		participants: participantsOf(email),
		parts: c.parts,
		attachments,
		messageId: email.messageId ?? null,
		listId: header(email, 'list-id'),
		warnings: c.warnings
	};
}

function recipients(value: unknown, role: Role): Participant[] {
	if (!Array.isArray(value)) return [];
	const out: Participant[] = [];
	for (const r of value) {
		if (!r || typeof r !== 'object') continue;
		const { address, name } = r as Record<string, unknown>;
		if (typeof address !== 'string' || !address.trim()) continue;
		out.push({ role, name: typeof name === 'string' ? name : '', address: address.trim() });
	}
	return out;
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

export function extractDraft(bytes: Uint8Array, limits: ExtractLimits = LIMITS): Extracted {
	let doc: DraftFields;
	try {
		doc = JSON.parse(new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))) as DraftFields;
		if (!doc || typeof doc !== 'object') throw new SyntaxError('draft');
	} catch {
		return { outcome: 'malformed', subject: null, participants: [], parts: [], attachments: [], messageId: null, listId: null, warnings: 0 };
	}
	const c = new Collector(limits);
	const text = str(doc.bodyText);
	const html = doc.bodyHtml ? htmlToText(str(doc.bodyHtml)) : '';
	if (text.trim()) c.body(text, 0);
	if (html && (!text.trim() || addsWords(html, text))) c.body(html, text.trim() ? 1 : 0);
	const participants: Participant[] = [];
	const from = doc.from as { email?: unknown; name?: unknown } | undefined;
	if (from && typeof from.email === 'string' && from.email.trim()) participants.push({ role: Role.from, name: str(from.name), address: from.email.trim() });
	participants.push(...recipients(doc.to, Role.to), ...recipients(doc.cc, Role.cc), ...recipients(doc.bcc, Role.bcc));
	const attachments: ExtractedAttachment[] = [];
	if (Array.isArray(doc.attachments)) {
		for (const item of doc.attachments.slice(0, limits.maxAttachments)) {
			if (!item || typeof item !== 'object') continue;
			const a = item as Record<string, unknown>;
			attachments.push({
				attachmentId: `draft:${attachments.length}`,
				filename: str(a.filename),
				mime: str(a.mime).toLowerCase() || 'application/octet-stream',
				size: typeof a.size === 'number' && a.size >= 0 ? a.size : 0,
				inline: a.disposition === 'inline'
			});
		}
		if (doc.attachments.length > limits.maxAttachments) c.limited = true;
	}
	return {
		outcome: c.limited ? 'resource_limited' : 'complete',
		subject: str(doc.subject) || null,
		participants,
		parts: c.parts,
		attachments,
		messageId: null,
		listId: null,
		warnings: c.warnings
	};
}

export async function extract(request: ExtractRequest, limits: ExtractLimits = LIMITS): Promise<Extracted> {
	return request.kind === 'draft' ? extractDraft(request.bytes, limits) : extractMime(request.bytes, limits);
}
