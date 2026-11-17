import type { SearchArtifactKey, SearchArtifactUploadItem, SearchSyncLimits } from '../../api/types';
import type { SearchArtifactRef } from '../../keystore/protocol';
import { DOCUMENT_EPOCH } from '../extract/epochs';
import type { JobContext, JobFactory } from '../runtime/host';
import type { StepOutcome } from '../runtime/scheduler';
import { Coverage, Dimension, SourceKind, type SearchDocument } from '../sqlite/types';
import type { SearchWriter } from '../sqlite/writer';
import { backoffDelay } from '../sync/backoff';
import { ATTACHMENT_JOB, BODY_JOB } from '../sync/jobs';
import type { BridgeFailure } from '../sync/protocol';
import { ArtifactState, QueueKind } from '../sync/store';
import { DocumentError, SETTLED_ATTACHMENT, decodeDocument, encodeDocument, readDocument, type DocumentPayload } from './document';
import { IndexState, type Listed } from './store';

export const HYDRATE_JOB = 'hydrate';
export const UPLOAD_JOB = 'upload';

const CURSOR = 'artifacts';
const HYDRATE_BATCH = 'hydrate-docs';
const RELIST_MS = 60_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SealOutcome = { ok: true; artifact: Uint8Array } | { ok: false; code: 'too_large' | 'unavailable' };
export type OpenOutcome = { ok: true; payload: Uint8Array } | { ok: false; code: 'invalid' | 'unavailable' };

export interface SyncSession {
	readonly generationId: string;
	readonly limits: SearchSyncLimits;
	listed: boolean;
	full: boolean;
	seal(ref: SearchArtifactRef, payload: Uint8Array): Promise<SealOutcome>;
	open(ref: SearchArtifactRef, artifact: Uint8Array): Promise<OpenOutcome>;
}

interface Cursor {
	generationId: string;
	afterSeq: number;
	complete: boolean;
}

export function attachGeneration(writer: SearchWriter, reset: () => void, generationId: string): void {
	writer.atomic(() => {
		const c = readCursor(writer);
		if (c?.generationId === generationId) return;
		reset();
		saveCursor(writer, { generationId, afterSeq: 0, complete: false });
	});
}

function readCursor(writer: SearchWriter): Cursor | null {
	const raw = writer.checkpoint(CURSOR);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Cursor;
	} catch {
		return null;
	}
}

function saveCursor(writer: SearchWriter, c: Cursor): void {
	writer.setCheckpoint({ job: CURSOR, cursor: JSON.stringify(c) });
}

function retryAfter(f: BridgeFailure): number | null {
	return f.code === 'pending' || f.code === 'retry' ? f.retryAfterSeconds : null;
}

function documentRef(sourceId: string, contentRevision: number, extractionRevision: number): SearchArtifactRef {
	return { kind: 'document', sourceKind: 'message', sourceId, contentRevision, componentEpoch: DOCUMENT_EPOCH, extractionRevision };
}

function documentKey(sourceId: string, contentRevision: number, componentEpoch: number): SearchArtifactKey {
	return { kind: 'document', sourceKind: 'message', sourceId, contentRevision, componentEpoch };
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
	return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hydratedDocument(sourceId: string, contentRevision: number, d: DocumentPayload): SearchDocument {
	const coverage: SearchDocument['coverage'] = { [Dimension.metadata]: Coverage.complete, [Dimension.body]: d.body };
	if (d.attachmentMetadata !== null) coverage[Dimension.attachmentMetadata] = d.attachmentMetadata;
	return {
		kind: SourceKind.message,
		sourceId,
		contentRevision,
		metadataRevision: -1,
		threadId: null,
		date: 0,
		flags: 0,
		knownFlags: 0,
		collections: [],
		extraction: 1,
		extractorEpoch: d.extractorEpoch,
		size: d.size,
		sizeVersion: d.sizeVersion,
		warnings: d.warnings,
		messageId: d.messageId,
		listId: d.listId,
		subject: d.subject,
		participants: d.participants,
		attachments: d.attachments,
		parts: d.parts,
		coverage
	};
}

function hasSource(ctx: JobContext, sourceId: string, contentRev: number): boolean {
	return ctx.db.selectValue('SELECT 1 FROM sources WHERE kind = ? AND source_id = ? AND content_rev = ?', [SourceKind.message, sourceId, contentRev]) === 1;
}

interface Hydrated {
	sourceId: string;
	contentRev: number;
	extractionRev: number;
	payload: DocumentPayload;
}

export const hydrateJob: JobFactory = (ctx) => {
	let attempt = 0;
	let relist = false;

	const wait = (f: BridgeFailure): StepOutcome => {
		if (f.code === 'generation' || f.code === 'vault_locked') return 'idle';
		ctx.later(HYDRATE_JOB, backoffDelay(attempt++, retryAfter(f)));
		return 'idle';
	};

	const list = async (s: SyncSession, c: Cursor): Promise<StepOutcome | null> => {
		const r = await ctx.bridge!.call({ op: 'artifactList', generationId: s.generationId, afterSeq: c.afterSeq, limit: s.limits.pageSize });
		if (ctx.sync() !== s) return 'idle';
		if (!r.ok) return wait(r.failure);
		attempt = 0;
		const rows: Listed[] = [];
		for (const i of r.value.items) {
			if (i.kind !== 'document' || i.sourceKind !== 'message' || !UUID_RE.test(i.sourceId)) continue;
			rows.push({
				sourceId: i.sourceId,
				contentRev: i.contentRevision,
				componentEpoch: i.componentEpoch,
				extractionRev: i.extractionRevision,
				seq: i.seq,
				state: i.componentEpoch === DOCUMENT_EPOCH ? IndexState.listed : IndexState.rejected
			});
		}
		const next: Cursor = { generationId: s.generationId, afterSeq: Math.max(c.afterSeq, r.value.throughSeq), complete: c.complete || r.value.complete };
		ctx.writer.atomic(() => {
			ctx.artifacts.list(rows);
			saveCursor(ctx.writer, next);
		});
		if (r.value.complete) {
			s.listed = true;
			ctx.wake(BODY_JOB);
			return null;
		}
		return 'more';
	};

	const hydrate = async (s: SyncSession): Promise<StepOutcome> => {
		const rows = ctx.artifacts.toHydrate(s.limits.batchItems);
		if (rows.length === 0) {
			if (ctx.artifacts.unextracted() > 0) {
				relist = true;
				ctx.later(HYDRATE_JOB, RELIST_MS);
			}
			ctx.wake(BODY_JOB);
			return 'idle';
		}
		const r = await ctx.bridge!.call({ op: 'artifactFetch', generationId: s.generationId, keys: rows.map((row) => documentKey(row.sourceId, row.contentRev, row.componentEpoch)) });
		if (ctx.sync() !== s) return 'idle';
		if (!r.ok) return wait(r.failure);
		attempt = 0;
		const byId = new Map(rows.map((row) => [row.sourceId, row]));
		let keyless = false;
		const hydrated: Hydrated[] = [];
		const rejected: { sourceId: string; contentRev: number }[] = [];
		const gone: { sourceId: string; contentRev: number }[] = [];
		for (const { item, bytes } of r.value) {
			const row = byId.get(item.sourceId);
			if (!row || item.contentRevision !== row.contentRev || item.kind !== 'document') continue;
			if (item.status === 'deferred') continue;
			if (item.status === 'gone' || !bytes || item.extractionRevision === undefined) {
				gone.push(row);
				continue;
			}
			const opened = await s.open(documentRef(row.sourceId, row.contentRev, item.extractionRevision), bytes);
			if (ctx.sync() !== s) return 'idle';
			if (!opened.ok) {
				if (opened.code === 'unavailable') {
					keyless = true;
					break;
				}
				rejected.push(row);
				continue;
			}
			try {
				hydrated.push({ sourceId: row.sourceId, contentRev: row.contentRev, extractionRev: item.extractionRevision, payload: decodeDocument(opened.payload) });
			} catch (error) {
				if (!(error instanceof DocumentError)) throw error;
				rejected.push(row);
			}
		}
		const batch = ctx.batch(HYDRATE_BATCH);
		const usable = hydrated.filter((h) => hasSource(ctx, h.sourceId, h.contentRev));
		for (const h of usable) batch.add(hydratedDocument(h.sourceId, h.contentRev, h.payload), null);
		if (usable.length === 0) batch.advance(null);
		const committed = await batch.commit(() => {
			for (const row of rejected) ctx.artifacts.mark(row.sourceId, row.contentRev, IndexState.rejected);
			for (const row of gone) ctx.artifacts.drop(row.sourceId, row.contentRev);
			for (const h of usable) apply(ctx, h);
		});
		if (!committed.ok) return 'blocked';
		if (usable.some((h) => h.payload.attachmentStates.some((a) => a.state === Coverage.pending))) ctx.wake(ATTACHMENT_JOB);
		if (rejected.length || gone.length) ctx.wake(BODY_JOB);
		return keyless ? 'idle' : 'more';
	};

	return {
		name: HYDRATE_JOB,
		class: 'body',
		receive() {
			ctx.wake(HYDRATE_JOB);
		},
		async step(step) {
			const s = ctx.sync();
			if (!s || !ctx.bridge) return 'idle';
			while (!step.shouldYield()) {
				const c = readCursor(ctx.writer);
				if (!c || c.generationId !== s.generationId) return 'idle';
				if (!s.listed || relist) {
					const out = await list(s, c);
					if (out !== null) return out;
					relist = false;
					continue;
				}
				const out = await hydrate(s);
				if (out !== 'more') return out;
			}
			return 'more';
		}
	};
};

function apply(ctx: JobContext, h: Hydrated): void {
	const key = { kind: QueueKind.message, sourceId: h.sourceId };
	const separate = h.payload.attachments.filter((a) => !a.inline);
	ctx.store.extracted(key, h.contentRev, h.payload.body, h.payload.extractorEpoch, null);
	ctx.store.queueAttachments(key, h.contentRev, separate);
	const states = new Map(h.payload.attachmentStates.map((a) => [a.attachmentId, a]));
	for (const a of separate) {
		const st = states.get(a.attachmentId);
		if (!st || !SETTLED_ATTACHMENT.includes(st.state)) continue;
		ctx.store.attached({ ...key, attachmentId: a.attachmentId, contentRev: h.contentRev, filename: a.filename, mime: a.mime, state: Coverage.pending, attempts: 0 }, st.state, st.epoch, null);
	}
	ctx.writer.refreshAttachmentCoverage({ kind: SourceKind.message, sourceId: h.sourceId });
	ctx.artifacts.hydrated(h.sourceId, h.contentRev, h.extractionRev);
}

export const uploadJob: JobFactory = (ctx) => {
	let attempt = 0;
	ctx.writer.atomic(() => ctx.artifacts.recover());

	return {
		name: UPLOAD_JOB,
		class: 'artifacts',
		receive() {
			ctx.wake(UPLOAD_JOB);
		},
		async step(step) {
			const s = ctx.sync();
			if (!s || !s.listed || s.full || !ctx.bridge) return 'idle';
			const now = ctx.now();
			const rows = ctx.artifacts.toUpload(s.limits.batchItems, now).filter((r) => UUID_RE.test(r.sourceId));
			if (rows.length === 0) {
				const at = ctx.artifacts.nextUpload(now);
				if (at !== null) ctx.later(UPLOAD_JOB, at - now);
				return 'idle';
			}
			ctx.writer.atomic(() => ctx.artifacts.claim(rows));
			const items: { item: SearchArtifactUploadItem; bytes: Uint8Array }[] = [];
			const local: typeof rows = [];
			const skipped: typeof rows = [];
			let bytes = 0;
			let keyless = false;
			for (const row of rows) {
				if (keyless || (step.shouldYield() && items.length)) {
					skipped.push(row);
					continue;
				}
				const doc = readDocument(ctx.db, SourceKind.message, row.sourceId, row.contentRev);
				if (!doc || doc.body !== Coverage.complete) {
					local.push(row);
					continue;
				}
				const extractionRevision = row.artifactRev + 1;
				const ref = documentRef(row.sourceId, row.contentRev, extractionRevision);
				const sealed = await s.seal(ref, encodeDocument(doc));
				if (ctx.sync() !== s) return 'idle';
				if (!sealed.ok) {
					if (sealed.code === 'too_large') local.push(row);
					else {
						keyless = true;
						skipped.push(row);
					}
					continue;
				}
				const n = sealed.artifact.byteLength;
				if (n > s.limits.maxArtifactBytes) {
					local.push(row);
					continue;
				}
				if (bytes + n > s.limits.batchBytes && items.length) {
					skipped.push(row);
					continue;
				}
				bytes += n;
				items.push({ item: { ...ref, length: n, sha256: await sha256(sealed.artifact) }, bytes: sealed.artifact });
			}
			const done = ctx.now();
			ctx.writer.atomic(() => {
				for (const row of local) ctx.artifacts.settle(row.sourceId, row.contentRev, ArtifactState.localOnly);
				for (const row of skipped) ctx.artifacts.defer(row.sourceId, row.contentRev, 0);
			});
			if (items.length === 0) return !keyless && (local.length || skipped.length) ? 'more' : 'idle';
			const r = await ctx.bridge.call(
				{ op: 'artifactUpload', generationId: s.generationId, items },
				items.map((i) => i.bytes.buffer as ArrayBuffer)
			);
			if (ctx.sync() !== s) return 'idle';
			if (!r.ok) {
				const delay = backoffDelay(attempt++, retryAfter(r.failure));
				if (r.failure.code === 'full') s.full = true;
				ctx.writer.atomic(() => {
					for (const { item } of items) ctx.artifacts.defer(item.sourceId, item.contentRevision, r.failure.code === 'retry' || r.failure.code === 'pending' ? done + delay : 0);
				});
				if (r.failure.code === 'retry' || r.failure.code === 'pending') ctx.later(UPLOAD_JOB, delay);
				return 'idle';
			}
			attempt = 0;
			ctx.writer.atomic(() => {
				const answered = new Set<string>();
				for (const res of r.value.results) {
					answered.add(res.sourceId);
					if (res.status === 'stored' || res.status === 'exists') ctx.artifacts.uploaded(res.sourceId, res.contentRevision, res.extractionRevision);
					else ctx.artifacts.settle(res.sourceId, res.contentRevision, ArtifactState.clean);
				}
				for (const { item } of items) if (!answered.has(item.sourceId)) ctx.artifacts.defer(item.sourceId, item.contentRevision, done + backoffDelay(0, null));
			});
			return keyless ? 'idle' : 'more';
		}
	};
};
