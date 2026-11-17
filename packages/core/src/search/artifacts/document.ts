import type { Database } from '@thelemail/sqlite-wasm';
import { EXTRACTOR_EPOCH, FILE_EXTRACTOR_EPOCH } from '../extract/epochs';
import { Coverage, Dimension, Field, Role, type Attachment, type Part, type Participant, type SourceKind } from '../sqlite/types';

export const DOCUMENT_VERSION = 1;

const MAX_ITEMS = 100_000;
const MAX_TEXT = 8 << 20;
const MAX_ID = 512;

const SKIPPED_FIELDS: readonly number[] = [Field.subject, Field.participant, Field.attachmentName];
const FIELDS = new Set<number>(Object.values(Field).filter((f) => !SKIPPED_FIELDS.includes(f)));
const ROLES = new Set<number>(Object.values(Role));
const COVERAGE = new Set<number>(Object.values(Coverage));

export const SETTLED_ATTACHMENT: readonly Coverage[] = [
	Coverage.complete,
	Coverage.partial,
	Coverage.passwordRequired,
	Coverage.unsupported,
	Coverage.resourceLimited,
	Coverage.failed
];

export interface AttachmentState {
	attachmentId: string;
	state: Coverage;
	epoch: number;
}

export interface DocumentPayload {
	extractorEpoch: number;
	size: number;
	sizeVersion: number;
	warnings: number;
	messageId: string | null;
	listId: string | null;
	subject: string | null;
	participants: Participant[];
	attachments: Attachment[];
	parts: Part[];
	attachmentStates: AttachmentState[];
	body: Coverage;
	attachmentMetadata: Coverage | null;
}

type Wire = {
	v: number;
	e: number;
	s: number;
	sv: number;
	w: number;
	m: string | null;
	l: string | null;
	j: string | null;
	p: [number, string, string][];
	a: [string, string, string, number, number][];
	t: [number, string, string | null, number | null, string | null][];
	q: [string, number, number][];
	b: number;
	am: number | null;
};

export function readDocument(db: Database, kind: SourceKind, sourceId: string, contentRev: number): DocumentPayload | null {
	const row = db.selectArray(
		'SELECT id, content_rev, message_id, list_id, size, extractor_epoch, size_version, warnings FROM sources WHERE kind = ? AND source_id = ?',
		[kind, sourceId]
	) as [number, number, string | null, string | null, number, number, number, number] | undefined;
	if (!row || row[1] !== contentRev) return null;
	const [id] = row;
	const coverage = new Map(
		(db.selectArrays('SELECT dimension, state FROM coverage WHERE source = ?', [id]) as [number, number][]).map(([d, s]) => [d, s as Coverage])
	);
	const body = coverage.get(Dimension.body);
	if (body === undefined) return null;
	const subject = db.selectValue('SELECT text FROM parts WHERE source = ? AND field = ? ORDER BY id LIMIT 1', [id, Field.subject]);
	const participants = (db.selectArrays('SELECT role, name, address FROM participants WHERE source = ? ORDER BY rowid', [id]) as [number, string, string][]).map(
		([role, name, address]) => ({ role: role as Role, name, address })
	);
	const attachments = (
		db.selectArrays('SELECT attachment_id, filename, mime, size, inline FROM attachments WHERE source = ? ORDER BY attachment_id', [id]) as [
			string,
			string,
			string,
			number,
			number
		][]
	).map(([attachmentId, filename, mime, size, inline]) => ({ attachmentId, filename, mime, size, ...(inline ? { inline: true } : {}) }));
	const parts = (
		db.selectArrays(
			`SELECT field, text, attachment_id, locator, place FROM parts WHERE source = ? AND field NOT IN (${SKIPPED_FIELDS.join(', ')}) ORDER BY id`,
			[id]
		) as [number, string, string | null, number | null, string | null][]
	).map(([field, text, attachmentId, locator, place]) => ({
		field: field as Field,
		text,
		...(attachmentId !== null ? { attachmentId } : {}),
		...(locator !== null ? { locator } : {}),
		...(place !== null ? { place } : {})
	}));
	const attachmentStates = (
		db.selectArrays('SELECT attachment_id, state, epoch FROM attachment_queue WHERE kind = ? AND source_id = ? AND content_rev = ? ORDER BY attachment_id', [
			kind,
			sourceId,
			contentRev
		]) as [string, number, number][]
	).map(([attachmentId, state, epoch]) =>
		SETTLED_ATTACHMENT.includes(state as Coverage) ? { attachmentId, state: state as Coverage, epoch } : { attachmentId, state: Coverage.pending, epoch: 0 }
	);
	return {
		extractorEpoch: row[5],
		size: row[4],
		sizeVersion: row[6],
		warnings: row[7],
		messageId: row[2],
		listId: row[3],
		subject: typeof subject === 'string' ? subject : null,
		participants,
		attachments,
		parts,
		attachmentStates,
		body,
		attachmentMetadata: coverage.get(Dimension.attachmentMetadata) ?? null
	};
}

export function encodeDocument(d: DocumentPayload): Uint8Array {
	const wire: Wire = {
		v: DOCUMENT_VERSION,
		e: d.extractorEpoch,
		s: d.size,
		sv: d.sizeVersion,
		w: d.warnings,
		m: d.messageId,
		l: d.listId,
		j: d.subject,
		p: d.participants.map((p) => [p.role, p.name, p.address]),
		a: d.attachments.map((a) => [a.attachmentId, a.filename, a.mime, a.size, a.inline ? 1 : 0]),
		t: d.parts.map((p) => [p.field, p.text, p.attachmentId ?? null, p.locator ?? null, p.place ?? null]),
		q: d.attachmentStates.map((a) => [a.attachmentId, a.state, a.epoch]),
		b: d.body,
		am: d.attachmentMetadata
	};
	return new TextEncoder().encode(JSON.stringify(wire));
}

export class DocumentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DocumentError';
	}
}

function fail(what: string): never {
	throw new DocumentError(what);
}

function int(v: unknown, what: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) fail(what);
	return v;
}

function str(v: unknown, what: string, max = MAX_TEXT): string {
	if (typeof v !== 'string' || v.length > max) fail(what);
	return v;
}

function strOrNull(v: unknown, what: string, max = MAX_TEXT): string | null {
	return v === null ? null : str(v, what, max);
}

function list(v: unknown, what: string): unknown[] {
	if (!Array.isArray(v) || v.length > MAX_ITEMS) fail(what);
	return v;
}

function tuple(v: unknown, n: number, what: string): unknown[] {
	if (!Array.isArray(v) || v.length !== n) fail(what);
	return v;
}

function coverage(v: unknown, what: string): Coverage {
	const n = int(v, what);
	if (!COVERAGE.has(n)) fail(what);
	return n as Coverage;
}

export function decodeDocument(bytes: Uint8Array): DocumentPayload {
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		fail('json');
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('shape');
	const w = raw as Partial<Record<keyof Wire, unknown>>;
	if (w.v !== DOCUMENT_VERSION) fail('version');
	const extractorEpoch = int(w.e, 'epoch');
	if (extractorEpoch !== EXTRACTOR_EPOCH) fail('epoch');
	const participants = list(w.p, 'participants').map((p) => {
		const [role, name, address] = tuple(p, 3, 'participant');
		const r = int(role, 'role');
		if (!ROLES.has(r)) fail('role');
		return { role: r as Role, name: str(name, 'name', MAX_ID), address: str(address, 'address', MAX_ID) };
	});
	const attachments = list(w.a, 'attachments').map((a) => {
		const [attachmentId, filename, mime, size, inline] = tuple(a, 5, 'attachment');
		const out: Attachment = { attachmentId: str(attachmentId, 'attachment id', MAX_ID), filename: str(filename, 'filename', MAX_ID), mime: str(mime, 'mime', MAX_ID), size: int(size, 'size') };
		if (int(inline, 'inline', 0, 1) === 1) out.inline = true;
		return out;
	});
	const ids = new Set(attachments.map((a) => a.attachmentId));
	if (ids.size !== attachments.length) fail('duplicate attachment');
	let textBytes = 0;
	const parts = list(w.t, 'parts').map((p) => {
		const [field, text, attachmentId, locator, place] = tuple(p, 5, 'part');
		const f = int(field, 'field');
		if (!FIELDS.has(f)) fail('field');
		const part: Part = { field: f as Field, text: str(text, 'text') };
		textBytes += part.text.length;
		if (textBytes > MAX_TEXT) fail('text');
		const aid = strOrNull(attachmentId, 'part attachment', MAX_ID);
		if (aid !== null) {
			if (!ids.has(aid)) fail('part attachment');
			part.attachmentId = aid;
		}
		if (locator !== null) part.locator = int(locator, 'locator');
		const pl = strOrNull(place, 'place', MAX_ID);
		if (pl !== null) part.place = pl;
		return part;
	});
	const seen = new Set<string>();
	const attachmentStates = list(w.q, 'attachment states').map((q) => {
		const [attachmentId, state, epoch] = tuple(q, 3, 'attachment state');
		const id = str(attachmentId, 'attachment state id', MAX_ID);
		if (!ids.has(id) || seen.has(id)) fail('attachment state id');
		seen.add(id);
		const st = coverage(state, 'attachment state');
		const ep = int(epoch, 'attachment epoch');
		if (st !== Coverage.pending && !SETTLED_ATTACHMENT.includes(st)) fail('attachment state');
		if (ep > FILE_EXTRACTOR_EPOCH) fail('attachment epoch');
		return { attachmentId: id, state: ep < FILE_EXTRACTOR_EPOCH ? Coverage.pending : st, epoch: ep < FILE_EXTRACTOR_EPOCH ? 0 : ep };
	});
	const body = coverage(w.b, 'body');
	if (body !== Coverage.complete) fail('body');
	return {
		extractorEpoch,
		size: int(w.s, 'size'),
		sizeVersion: int(w.sv, 'size version'),
		warnings: int(w.w, 'warnings'),
		messageId: strOrNull(w.m, 'message id', MAX_ID),
		listId: strOrNull(w.l, 'list id', MAX_ID),
		subject: strOrNull(w.j, 'subject'),
		participants,
		attachments,
		parts,
		attachmentStates,
		body,
		attachmentMetadata: w.am === null ? null : coverage(w.am, 'attachment metadata')
	};
}
