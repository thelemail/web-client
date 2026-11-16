import type {
	SearchSourceChangeEntry,
	SearchSourceDescriptor,
	SearchSourceDescriptorResult,
	SearchSourceKind
} from '../../api/types';
import { parse } from '../extract/parse';
import type { JobInput, JobOutcome, JobTicket } from '../parser/protocol';
import type { BridgeMessage, BridgeReply, BridgeResult } from './protocol';

export interface FakeMessage {
	id: string;
	mime: string;
	preview: { subject: string; sender: { display: string; address: string }; recipients: { display: string; address: string; kind: string }[]; snippet: string };
	mailboxState?: 'inbox' | 'archive' | 'trash' | 'spam' | 'snoozed' | 'folder';
	direction?: 'sent' | 'received';
	read?: boolean;
	storedAt?: number;
	key?: string;
	held?: boolean;
	files?: FakeFile[];
}

export interface FakeFile {
	id: string;
	filename: string;
	mime: string;
	bytes: Uint8Array;
	locked?: boolean;
}

export interface FakeDraft {
	id: string;
	doc: unknown;
	raw?: string;
}

interface Source {
	kind: SearchSourceKind;
	sourceId: string;
	createdSeq: number;
	sourceRevision: number;
	contentRevision: number;
	metadataRevision: number;
	state: 'live' | 'held' | 'deleted';
	message?: FakeMessage;
	draft?: FakeDraft & { updatedAt: string };
	scheduled?: { copy: string | null; scheduledAt: string; preview: FakeMessage['preview'] };
	alias?: { keyEpoch: number };
}

const enc = new TextEncoder();

function b64(text: string): string {
	return btoa(String.fromCharCode(...enc.encode(text)));
}

function unb64(data: string): string {
	return new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
}

const KIND_ORDER: SearchSourceKind[] = ['message', 'draft', 'scheduled', 'collection', 'alias'];

export class FakeSource {
	seq = 0;
	minRetainedSeq = 0;
	pageSize = 25;
	locked = new Set<string>();
	ops: string[] = [];
	#sources = new Map<string, Source>();
	#journal: SearchSourceChangeEntry[] = [];
	#gate: Promise<void> | null = null;
	#release: (() => void) | null = null;

	#k(kind: SearchSourceKind, id: string): string {
		return `${kind}:${id}`;
	}

	#emit(source: Source, change: SearchSourceChangeEntry['change'], content: boolean): void {
		const seq = ++this.seq;
		source.sourceRevision = seq;
		source.metadataRevision = seq;
		if (content) source.contentRevision = seq;
		this.#journal.push({ seq, kind: source.kind, sourceId: source.sourceId, change, contentRevision: source.contentRevision, metadataRevision: source.metadataRevision });
	}

	#create(kind: SearchSourceKind, sourceId: string, fill: Partial<Source>, held = false): Source {
		const seq = this.seq + 1;
		const source: Source = { kind, sourceId, createdSeq: seq, sourceRevision: seq, contentRevision: seq, metadataRevision: seq, state: held ? 'held' : 'live', ...fill };
		this.#sources.set(this.#k(kind, sourceId), source);
		this.#emit(source, held ? 'held' : 'created', true);
		return source;
	}

	addMessage(m: FakeMessage): void {
		this.#create('message', m.id, { message: { storedAt: Date.UTC(2026, 9, 1) + this.seq * 60_000, ...m } }, m.held);
	}

	addDraft(d: FakeDraft): void {
		this.#create('draft', d.id, { draft: { ...d, updatedAt: new Date(Date.UTC(2026, 10, 1) + this.seq * 1000).toISOString() } });
	}

	addScheduled(id: string, copy: string | null, preview: FakeMessage['preview']): void {
		this.#create('scheduled', id, { scheduled: { copy, scheduledAt: new Date(Date.UTC(2026, 11, 24)).toISOString(), preview } });
	}

	addAlias(id: string): void {
		this.#create('alias', id, { alias: { keyEpoch: 1 } });
	}

	bumpAlias(id: string): void {
		const s = this.#sources.get(this.#k('alias', id))!;
		s.alias!.keyEpoch++;
		this.#emit(s, 'metadata', false);
	}

	move(id: string, mailboxState: FakeMessage['mailboxState']): void {
		const s = this.#sources.get(this.#k('message', id))!;
		s.message!.mailboxState = mailboxState;
		this.#emit(s, 'metadata', false);
	}

	markRead(id: string): void {
		const s = this.#sources.get(this.#k('message', id))!;
		s.message!.read = true;
		this.#emit(s, 'metadata', false);
	}

	release(id: string): void {
		const s = this.#sources.get(this.#k('message', id))!;
		s.state = 'live';
		this.#emit(s, 'activated', false);
	}

	editDraft(id: string, doc: unknown): void {
		const s = this.#sources.get(this.#k('draft', id))!;
		s.draft!.doc = doc;
		s.draft!.updatedAt = new Date(Date.UTC(2026, 10, 2) + this.seq * 1000).toISOString();
		this.#emit(s, 'content', true);
	}

	remove(kind: SearchSourceKind, id: string): void {
		const s = this.#sources.get(this.#k(kind, id))!;
		s.state = 'deleted';
		this.#emit(s, 'deleted', false);
	}

	pruneJournal(): void {
		this.minRetainedSeq = this.seq;
		this.#journal = [];
	}

	#fileGate: Promise<void> | null = null;
	#releaseFiles: (() => void) | null = null;

	holdFiles(): void {
		this.#fileGate = new Promise((resolve) => (this.#releaseFiles = resolve));
	}

	resumeFiles(): void {
		this.#releaseFiles?.();
		this.#fileGate = null;
	}

	hold(): void {
		this.#gate = new Promise((resolve) => (this.#release = resolve));
	}

	resume(): void {
		this.#release?.();
		this.#gate = null;
	}

	#bodyPointer(s: Source) {
		return { path: `/v1/${s.kind}s/${s.sourceId}/body`, sizeBytes: 1, sha256: `rev-${s.contentRevision}`, keyFingerprint: s.message?.key };
	}

	#previewOf(s: Source): string {
		const preview = s.message?.preview ?? s.scheduled?.preview ?? { subject: '', sender: { display: '', address: '' }, recipients: [], snippet: '' };
		return b64(JSON.stringify({ key: s.message?.key ?? null, preview: { v: 1, display_date: '', ...preview } }));
	}

	describe(s: Source): SearchSourceDescriptor {
		const base: SearchSourceDescriptor = {
			kind: s.kind,
			sourceId: s.sourceId,
			createdSeq: s.createdSeq,
			sourceRevision: s.sourceRevision,
			contentRevision: s.contentRevision,
			metadataRevision: s.metadataRevision,
			state: s.state,
			relation: 'owner'
		};
		if (s.state !== 'live') return base;
		if (s.message) {
			const m = s.message;
			base.message = {
				direction: m.direction ?? 'received',
				mailboxState: m.mailboxState ?? 'inbox',
				read: m.read ?? false,
				starred: false,
				labelIds: [],
				storedAt: new Date(m.storedAt!).toISOString(),
				encrypted: true,
				schemaVersion: 1,
				encryptedPreview: this.#previewOf(s),
				body: this.#bodyPointer(s),
				attachmentsInBody: !m.files?.length,
				attachments: (m.files ?? []).map((f, ordinal) => ({
					id: f.id,
					ordinal,
					inline: false,
					blob: { path: `/v1/messages/${s.sourceId}/attachments/${f.id}`, sizeBytes: f.bytes.length, sha256: `rev-${s.contentRevision}` }
				}))
			};
		}
		if (s.draft) base.draft = { schemaVersion: 1, encryptedPreview: this.#previewOf(s), body: this.#bodyPointer(s) };
		if (s.scheduled) {
			base.scheduled = { status: 'pending', scheduledAt: s.scheduled.scheduledAt, senderCopyMessageId: s.scheduled.copy ?? undefined, encryptedPreview: this.#previewOf(s) };
		}
		if (s.alias) {
			base.relation = 'member';
			base.alias = { keyEpoch: s.alias.keyEpoch, grants: [] };
		}
		return base;
	}

	#sorted(): Source[] {
		return [...this.#sources.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.sourceId.localeCompare(b.sourceId));
	}

	async handle(r: BridgeMessage): Promise<BridgeResult<unknown>> {
		this.ops.push(r.op);
		if (this.#gate && (r.op === 'body' || r.op === 'draft')) await this.#gate;
		if (this.#fileGate && r.op === 'attachmentBytes') await this.#fileGate;
		switch (r.op) {
			case 'barrier':
				return { ok: true, value: { throughSeq: this.seq, minRetainedSeq: this.minRetainedSeq, serverTime: new Date().toISOString() } };
			case 'snapshot': {
				const cursor = r.cursor ? (JSON.parse(r.cursor) as { c0: number; after: number }) : { c0: this.seq, after: 0 };
				const eligible = this.#sorted().filter((s) => s.createdSeq <= cursor.c0 && s.state !== 'deleted');
				const items = eligible.slice(cursor.after, cursor.after + this.pageSize);
				const next = cursor.after + items.length;
				return {
					ok: true,
					value: {
						c0: cursor.c0,
						items: items.map((s) => this.describe(s)),
						nextCursor: next < eligible.length ? JSON.stringify({ c0: cursor.c0, after: next }) : undefined,
						expiresAt: new Date(Date.now() + 86_400_000).toISOString()
					}
				};
			}
			case 'changes': {
				if (r.afterSeq < this.minRetainedSeq) return { ok: false, failure: { code: 'expired', minRetainedSeq: this.minRetainedSeq, committedSeq: this.seq } };
				const through = r.throughSeq ?? this.seq;
				const entries = this.#journal.filter((e) => e.seq > r.afterSeq && e.seq <= through).slice(0, 500);
				const complete = entries.length < 500;
				return { ok: true, value: { afterSeq: r.afterSeq, throughSeq: through, entries, nextAfterSeq: complete ? through : entries[entries.length - 1].seq, complete } };
			}
			case 'describe': {
				const results: SearchSourceDescriptorResult[] = r.items.map((item) => {
					const s = this.#sources.get(this.#k(item.kind, item.sourceId));
					if (!s) return { kind: item.kind, sourceId: item.sourceId, status: 'inaccessible' };
					const descriptor = this.describe(s);
					if (s.state === 'deleted') return { kind: s.kind, sourceId: s.sourceId, status: 'deleted', descriptor };
					if (s.state === 'held') return { kind: s.kind, sourceId: s.sourceId, status: 'held', descriptor };
					const status = item.revision !== undefined && item.revision < s.sourceRevision ? 'newer_revision' : 'ready';
					return { kind: s.kind, sourceId: s.sourceId, status, descriptor };
				});
				return { ok: true, value: { results, deferred: [] } };
			}
			case 'preview': {
				const parsed = JSON.parse(unb64(r.data)) as { key: string | null; preview: unknown };
				if (parsed.key && this.locked.has(parsed.key)) return { ok: false, failure: { code: 'locked' } };
				return { ok: true, value: JSON.stringify(parsed.preview) };
			}
			case 'body': {
				const id = r.pointer.path.split('/')[3];
				const kind = r.pointer.path.split('/')[2].replace(/s$/, '') as SearchSourceKind;
				const s = this.#sources.get(this.#k(kind, id));
				if (!s || s.state !== 'live') return { ok: false, failure: { code: 'gone' } };
				if (r.pointer.sha256 !== `rev-${s.contentRevision}`) return { ok: false, failure: { code: 'changed' } };
				if (s.message?.key && this.locked.has(s.message.key)) return { ok: false, failure: { code: 'locked' } };
				const mime = enc.encode(s.message!.mime.replace(/\n/g, '\r\n'));
				return { ok: true, value: { storedBytes: mime.length, mime } };
			}
			case 'draft': {
				const s = this.#sources.get(this.#k('draft', r.draftId));
				if (!s || s.state !== 'live') return { ok: false, failure: { code: 'gone' } };
				if (r.pointer.sha256 !== `rev-${s.contentRevision}`) return { ok: false, failure: { code: 'changed' } };
				const json = enc.encode(s.draft!.raw ?? JSON.stringify(s.draft!.doc));
				return { ok: true, value: { storedBytes: json.length, json, updatedAt: s.draft!.updatedAt } };
			}
			case 'attachment':
			case 'attachmentBytes': {
				const file = this.#file(r.pointer.path);
				if (!file) return { ok: false, failure: { code: 'gone' } };
				if (r.op === 'attachment') return { ok: true, value: { filename: file.filename, contentType: file.mime, inline: false, size: file.bytes.length } };
				if (file.locked) return { ok: false, failure: { code: 'locked' } };
				return { ok: true, value: { bytes: file.bytes.slice(), filename: file.filename, contentType: file.mime } };
			}
			case 'draftAttachment':
				return { ok: false, failure: { code: 'gone' } };
		}
	}

	#file(path: string): FakeFile | null {
		const [, , , id, , fileId] = path.split('/');
		return this.#sources.get(this.#k('message', id))?.message?.files?.find((f) => f.id === fileId) ?? null;
	}

	serve(port: MessagePort): () => void {
		port.onmessage = async (e: MessageEvent<BridgeMessage>) => {
			const result = await this.handle(e.data);
			port.postMessage({ id: e.data.id, result } satisfies BridgeReply);
		};
		port.start();
		return () => port.close();
	}
}

export function localParser(onJob?: (ticket: JobTicket) => Promise<void> | void): MessagePort {
	const channel = new MessageChannel();
	channel.port1.onmessage = (e: MessageEvent<JobTicket>) => {
		const job = e.ports[0];
		const ticket = e.data;
		if (!job || ticket?.type !== 'job') return;
		job.onmessage = async (m: MessageEvent<JobInput>) => {
			await onJob?.(ticket);
			let outcome: JobOutcome;
			try {
				outcome = { jobId: ticket.jobId, ok: true, result: await parse(m.data.request, () => {}) };
			} catch {
				outcome = { jobId: ticket.jobId, ok: false, reason: 'crashed' };
			}
			job.postMessage(outcome);
			job.close();
		};
		job.start();
	};
	channel.port1.start();
	return channel.port2;
}
