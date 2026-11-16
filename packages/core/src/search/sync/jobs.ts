import type { SearchSourceChangeEntry, SearchSourceDescriptor, SearchSourceDescriptorResult } from '../../api/types';
import { EXTRACTOR_EPOCH, type Extracted, type ExtractRequest } from '../extract/extract';
import type { JobContext, JobFactory } from '../runtime/host';
import type { StepOutcome } from '../runtime/scheduler';
import { Coverage, Dimension, Field, Role, SourceKind, type Attachment, type Participant, type SearchDocument } from '../sqlite/types';
import { backoffDelay } from './backoff';
import { MESSAGE_FLAGS, SIZE_VERSION, parsePreview, previewDocument, storedAtOf, type Preview, type PreviewOutcome } from './documents';
import type { BridgeFailure, BridgeResult } from './protocol';
import { KIND_NAME, QueueKind, QueueState, isDocumentKind, type Pointers, type QueueKey, type QueueRow, type Revisions } from './store';

export const SYNC_JOB = 'sync';
export const DESCRIBE_JOB = 'describe';
export const BODY_JOB = 'body';

const POLL_MS = 60_000;
const DESCRIBE_BATCH = 50;
const DOWNLOADS = 2;
const COPY_WAIT_MS = 30_000;
const MAX_BODY_BYTES = 64 * 1024 * 1024;

export type SyncPhase = 'snapshot' | 'barrier' | 'drain' | 'live';

export type SyncCursor =
	| { phase: 'snapshot'; epoch: number; cursor: string | null; c0: number | null }
	| { phase: 'barrier'; epoch: number; c0: number }
	| { phase: 'drain'; epoch: number; afterSeq: number; throughSeq: number }
	| { phase: 'live'; epoch: number; afterSeq: number };

export interface SyncProgress {
	phase: SyncPhase | null;
	seq: number | null;
	syncedAt: number | null;
	waiting: BridgeFailure['code'] | null;
}

const KIND_OF: Record<string, QueueKind> = QueueKind;

function keyOf(kind: string, sourceId: string): QueueKey {
	return { kind: KIND_OF[kind], sourceId };
}

function revisionsOf(d: SearchSourceDescriptor): Revisions {
	return {
		sourceRev: d.sourceRevision,
		contentRev: d.contentRevision,
		metadataRev: d.metadataRevision,
		state: d.state === 'held' ? QueueState.held : d.state === 'deleted' ? QueueState.deleted : QueueState.live
	};
}

function retryAfter(f: BridgeFailure): number | null {
	return f.code === 'pending' || f.code === 'retry' ? f.retryAfterSeconds : null;
}

function transient(f: BridgeFailure): boolean {
	return f.code === 'pending' || f.code === 'retry';
}

function forget(ctx: JobContext, key: QueueKey, sourceRev: number): void {
	ctx.store.tombstone(key, sourceRev);
	if (isDocumentKind(key.kind)) ctx.writer.delete({ kind: key.kind, sourceId: key.sourceId });
}

function extractionOf(ctx: JobContext, kind: SourceKind, sourceId: string): number | null {
	const v = ctx.db.selectValue('SELECT extraction FROM sources WHERE kind = ? AND source_id = ?', [kind, sourceId]);
	return typeof v === 'number' ? v : null;
}

type Plan =
	| { type: 'document'; key: QueueKey; d: SearchSourceDescriptor; doc: SearchDocument; pointers: Pointers | null; unsupported: boolean }
	| { type: 'collection'; key: QueueKey; d: SearchSourceDescriptor }
	| { type: 'alias'; key: QueueKey; d: SearchSourceDescriptor }
	| { type: 'held'; key: QueueKey; d: SearchSourceDescriptor }
	| { type: 'unavailable'; key: QueueKey; d: SearchSourceDescriptor | null; contentRev: number }
	| { type: 'gone'; key: QueueKey; sourceRev: number };

function previewData(d: SearchSourceDescriptor): string | null {
	return d.message?.encryptedPreview ?? d.draft?.encryptedPreview ?? d.scheduled?.encryptedPreview ?? null;
}

function pointersOf(d: SearchSourceDescriptor): Pointers | null {
	if (d.message) {
		return {
			kind: 'message',
			body: d.message.body,
			attachmentsInBody: d.message.attachmentsInBody,
			attachments: d.message.attachments.map((a) => ({ id: a.id, inline: a.inline, blob: a.blob }))
		};
	}
	if (d.draft) return { kind: 'draft', body: d.draft.body };
	if (d.scheduled) return { kind: 'scheduled', senderCopyMessageId: d.scheduled.senderCopyMessageId ?? null };
	return null;
}

async function planDescriptor(ctx: JobContext, d: SearchSourceDescriptor): Promise<Plan | BridgeFailure> {
	const key = keyOf(d.kind, d.sourceId);
	if (d.state === 'deleted') return { type: 'gone', key, sourceRev: d.sourceRevision };
	if (d.state === 'held') return { type: 'held', key, d };
	if (key.kind === QueueKind.collection) return d.collection ? { type: 'collection', key, d } : { type: 'unavailable', key, d, contentRev: d.contentRevision };
	if (key.kind === QueueKind.alias) return { type: 'alias', key, d };
	if (!isDocumentKind(key.kind) || !(d.message || d.draft || d.scheduled)) return { type: 'unavailable', key, d, contentRev: d.contentRevision };
	const data = previewData(d);
	let outcome: PreviewOutcome = { preview: null, metadata: Coverage.complete };
	if (data) {
		const r = await ctx.bridge!.call({ op: 'preview', data });
		if (r.ok) {
			const preview: Preview | null = parsePreview(r.value);
			outcome = { preview, metadata: preview ? Coverage.complete : Coverage.failed };
		} else if (r.failure.code === 'locked') {
			outcome = { preview: null, metadata: Coverage.locked };
		} else if (r.failure.code === 'failed') {
			outcome = { preview: null, metadata: Coverage.failed };
		} else {
			return r.failure;
		}
	}
	const unsupported = key.kind === QueueKind.scheduled && !d.scheduled?.senderCopyMessageId;
	const doc = previewDocument(key.kind, d, outcome, unsupported ? Coverage.unsupported : Coverage.pending);
	return { type: 'document', key, d, doc, pointers: pointersOf(d), unsupported };
}

function applyPlan(ctx: JobContext, plan: Plan): void {
	switch (plan.type) {
		case 'gone':
			forget(ctx, plan.key, plan.sourceRev);
			return;
		case 'held':
			ctx.store.described(plan.key, revisionsOf(plan.d), storedAtOf(plan.d), null);
			if (isDocumentKind(plan.key.kind)) ctx.writer.delete({ kind: plan.key.kind, sourceId: plan.key.sourceId });
			return;
		case 'collection':
			ctx.store.putCollection(plan.key.sourceId, plan.d.collection!);
			ctx.store.described(plan.key, revisionsOf(plan.d), 0, null);
			return;
		case 'alias': {
			const changed = ctx.store.putAlias(plan.key.sourceId, plan.d.relation, plan.d.alias?.keyEpoch ?? 0, plan.d.alias?.grants ?? []);
			ctx.store.described(plan.key, revisionsOf(plan.d), 0, null);
			if (changed && plan.d.relation !== 'revoked') ctx.store.retryLocked();
			return;
		}
		case 'unavailable':
			if (plan.d) ctx.store.described(plan.key, revisionsOf(plan.d), storedAtOf(plan.d), null);
			ctx.store.extracted(plan.key, plan.contentRev, Coverage.failed, EXTRACTOR_EPOCH, 'unavailable');
			if (isDocumentKind(plan.key.kind)) ctx.writer.setCoverage({ kind: plan.key.kind, sourceId: plan.key.sourceId }, Dimension.body, Coverage.failed);
			return;
		case 'document': {
			const kind = plan.key.kind as SourceKind;
			const result = ctx.writer.put(plan.doc);
			if (result === 'unchanged' && plan.doc.coverage[Dimension.metadata] === Coverage.complete && extractionOf(ctx, kind, plan.key.sourceId) === 0) {
				ctx.writer.delete({ kind, sourceId: plan.key.sourceId });
				ctx.writer.put(plan.doc);
			}
			ctx.store.described(plan.key, revisionsOf(plan.d), storedAtOf(plan.d), plan.pointers);
			if (plan.unsupported) ctx.store.extracted(plan.key, plan.d.contentRevision, Coverage.unsupported, EXTRACTOR_EPOCH, null);
			return;
		}
	}
}

async function planAll(ctx: JobContext, descriptors: readonly SearchSourceDescriptor[]): Promise<{ plans: Plan[]; failure: BridgeFailure | null; failed: SearchSourceDescriptor[] }> {
	const plans: Plan[] = [];
	const failed: SearchSourceDescriptor[] = [];
	let failure: BridgeFailure | null = null;
	for (const d of descriptors) {
		if (!KIND_OF[d.kind]) continue;
		if (failure) {
			failed.push(d);
			continue;
		}
		const plan = await planDescriptor(ctx, d);
		if ('type' in plan) plans.push(plan);
		else {
			failure = plan;
			failed.push(d);
		}
	}
	return { plans, failure, failed };
}

export const sourceSyncJob: JobFactory = (ctx) => {
	let attempt = 0;

	const load = (): SyncCursor => {
		const raw = ctx.writer.checkpoint(SYNC_JOB);
		if (raw) {
			try {
				return JSON.parse(raw) as SyncCursor;
			} catch {
				return { phase: 'snapshot', epoch: 1, cursor: null, c0: null };
			}
		}
		return { phase: 'snapshot', epoch: 1, cursor: null, c0: null };
	};

	const save = (c: SyncCursor) => ctx.writer.setCheckpoint({ job: SYNC_JOB, cursor: JSON.stringify(c) });

	const report = (c: SyncCursor) => {
		ctx.progress.phase = c.phase;
		ctx.progress.seq = c.phase === 'drain' || c.phase === 'live' ? c.afterSeq : null;
	};

	const wait = (f: BridgeFailure): StepOutcome => {
		ctx.progress.waiting = f.code;
		if (f.code !== 'vault_locked') ctx.later(SYNC_JOB, backoffDelay(attempt++, retryAfter(f)));
		return 'idle';
	};

	const apply = (e: SearchSourceChangeEntry) => {
		const kind = KIND_OF[e.kind];
		if (!kind) return;
		if (e.change === 'invalidated') {
			ctx.store.invalidate(kind);
			return;
		}
		if (!e.sourceId) return;
		const key = { kind, sourceId: e.sourceId };
		if (e.change === 'deleted') {
			forget(ctx, key, e.seq);
			return;
		}
		const state = e.change === 'held' ? QueueState.held : QueueState.live;
		ctx.store.merge(key, { sourceRev: e.seq, contentRev: e.contentRevision, metadataRev: e.metadataRevision, state });
	};

	return {
		name: SYNC_JOB,
		class: 'metadata',
		receive() {
			ctx.wake(SYNC_JOB);
		},
		async step(step) {
			const bridge = ctx.bridge;
			if (!bridge) return 'idle';
			let c = load();
			report(c);
			while (!step.shouldYield()) {
				if (c.phase === 'snapshot') {
					const r = await bridge.call({ op: 'snapshot', cursor: c.cursor });
					if (!r.ok) {
						if ((r.failure.code === 'expired' || r.failure.code === 'failed') && c.cursor !== null) {
							c = { phase: 'snapshot', epoch: c.epoch, cursor: null, c0: null };
							save(c);
							continue;
						}
						return wait(r.failure);
					}
					const page = r.value;
					const { plans, failed } = await planAll(ctx, page.items);
					const epoch = c.epoch;
					const next: SyncCursor = page.nextCursor
						? { phase: 'snapshot', epoch, cursor: page.nextCursor, c0: page.c0 }
						: { phase: 'barrier', epoch, c0: page.c0 };
					ctx.writer.atomic(() => {
						for (const d of page.items) {
							const kind = KIND_OF[d.kind];
							if (!kind) continue;
							if (d.state !== 'deleted') ctx.store.merge({ kind, sourceId: d.sourceId }, revisionsOf(d), epoch);
						}
						for (const plan of plans) applyPlan(ctx, plan);
						for (const d of failed) ctx.store.merge(keyOf(d.kind, d.sourceId), revisionsOf(d), epoch);
						save(next);
					});
					c = next;
				} else if (c.phase === 'barrier') {
					const r = await bridge.call({ op: 'barrier' });
					if (!r.ok) return wait(r.failure);
					const through = r.value.throughSeq;
					const epoch = c.epoch;
					const c0 = c.c0;
					const next: SyncCursor = { phase: 'drain', epoch, afterSeq: c0, throughSeq: Math.max(through, c0) };
					ctx.writer.atomic(() => {
						for (const key of ctx.store.unseen(epoch, c0)) forget(ctx, key, c0);
						save(next);
					});
					c = next;
				} else {
					const r = await bridge.call(
						c.phase === 'drain' ? { op: 'changes', afterSeq: c.afterSeq, throughSeq: c.throughSeq } : { op: 'changes', afterSeq: c.afterSeq }
					);
					if (!r.ok) {
						if (r.failure.code === 'expired') {
							c = { phase: 'snapshot', epoch: c.epoch + 1, cursor: null, c0: null };
							save(c);
							continue;
						}
						return wait(r.failure);
					}
					const page = r.value;
					const current = c;
					const next: SyncCursor = page.complete
						? { phase: 'live', epoch: current.epoch, afterSeq: page.throughSeq }
						: { ...current, afterSeq: page.nextAfterSeq };
					ctx.writer.atomic(() => {
						for (const e of page.entries) apply(e);
						save(next);
					});
					c = next;
					if (current.phase === 'live' && page.complete) {
						attempt = 0;
						ctx.progress.syncedAt = ctx.now();
						ctx.progress.waiting = null;
						report(c);
						ctx.wake(DESCRIBE_JOB);
						ctx.later(SYNC_JOB, POLL_MS);
						return 'idle';
					}
				}
				attempt = 0;
				ctx.progress.waiting = null;
				report(c);
				ctx.wake(DESCRIBE_JOB);
			}
			return 'more';
		}
	};
};

export const describeJob: JobFactory = (ctx) => {
	let attempt = 0;
	return {
		name: DESCRIBE_JOB,
		class: 'metadata',
		receive(message) {
			if ((message as { retryLocked?: boolean })?.retryLocked) ctx.writer.atomic(() => ctx.store.retryLocked());
			ctx.wake(DESCRIBE_JOB);
			ctx.wake(BODY_JOB);
		},
		async step(step) {
			const bridge = ctx.bridge;
			if (!bridge) return 'idle';
			while (!step.shouldYield()) {
				const now = ctx.now();
				const rows = ctx.store.toDescribe(DESCRIBE_BATCH, now);
				if (rows.length === 0) {
					const at = ctx.store.nextWake(now);
					if (at !== null) ctx.later(DESCRIBE_JOB, at - now);
					ctx.wake(BODY_JOB);
					return 'idle';
				}
				const byKey = new Map(rows.map((r) => [`${r.kind}:${r.sourceId}`, r]));
				const r = await bridge.call({
					op: 'describe',
					items: rows.map((row) => ({ kind: KIND_NAME[row.kind], sourceId: row.sourceId, revision: row.sourceRev }))
				});
				if (!r.ok) {
					if (r.failure.code === 'vault_locked') return 'idle';
					const delay = backoffDelay(attempt++, retryAfter(r.failure));
					ctx.writer.atomic(() => {
						for (const row of rows) ctx.store.defer(row, now + delay, r.failure.code);
					});
					ctx.later(DESCRIBE_JOB, delay);
					return 'idle';
				}
				attempt = 0;
				const descriptors: SearchSourceDescriptor[] = [];
				const plans: Plan[] = [];
				for (const result of r.value.results) plans.push(...immediate(result, byKey, descriptors));
				const planned = await planAll(ctx, descriptors);
				const delay = planned.failure ? backoffDelay(attempt++, retryAfter(planned.failure)) : 0;
				ctx.writer.atomic(() => {
					for (const plan of [...plans, ...planned.plans]) applyPlan(ctx, plan);
					for (const d of planned.failed) ctx.store.defer(keyOf(d.kind, d.sourceId), now + delay, planned.failure!.code);
				});
				if (planned.failure) {
					if (planned.failure.code === 'vault_locked') return 'idle';
					ctx.later(DESCRIBE_JOB, delay);
				}
				ctx.wake(BODY_JOB);
			}
			return 'more';
		}
	};
};

function immediate(result: SearchSourceDescriptorResult, byKey: Map<string, QueueRow>, descriptors: SearchSourceDescriptor[]): Plan[] {
	const key = keyOf(result.kind, result.sourceId);
	const row = byKey.get(`${key.kind}:${key.sourceId}`);
	switch (result.status) {
		case 'ready':
		case 'newer_revision':
			if (result.descriptor) descriptors.push(result.descriptor);
			return [];
		case 'held':
			return result.descriptor ? [{ type: 'held', key, d: result.descriptor }] : [];
		case 'deleted':
		case 'inaccessible':
			return [{ type: 'gone', key, sourceRev: result.descriptor?.sourceRevision ?? row?.sourceRev ?? 0 }];
		case 'unavailable':
			return [{ type: 'unavailable', key, d: result.descriptor ?? null, contentRev: result.descriptor?.contentRevision ?? row?.contentRev ?? 0 }];
	}
}

interface BodyResult {
	row: QueueRow;
	doc?: SearchDocument;
	state: Coverage;
	reason: string | null;
	coverage?: [Dimension, Coverage][];
	defer?: { delay: number; reason: string };
	redescribe?: boolean;
	stop?: boolean;
}

function failureResult(row: QueueRow, f: BridgeFailure, attempt: number): BodyResult {
	switch (f.code) {
		case 'locked':
			return { row, state: Coverage.locked, reason: 'key', coverage: [[Dimension.body, Coverage.locked]] };
		case 'changed':
		case 'gone':
			return { row, state: Coverage.pending, reason: f.code, redescribe: true };
		case 'vault_locked':
			return { row, state: Coverage.pending, reason: null, stop: true };
		case 'failed':
			return { row, state: Coverage.failed, reason: f.reason, coverage: [[Dimension.body, Coverage.failed]] };
		default:
			return { row, state: Coverage.pending, reason: f.code, defer: { delay: backoffDelay(attempt, retryAfter(f)), reason: f.code } };
	}
}

function bodyCoverage(outcome: Extracted['outcome']): Coverage {
	return outcome === 'complete' ? Coverage.complete : outcome === 'resource_limited' ? Coverage.resourceLimited : Coverage.failed;
}

function existingParticipants(ctx: JobContext, kind: SourceKind, sourceId: string): Participant[] {
	return (
		ctx.db.selectArrays('SELECT p.role, p.name, p.address FROM participants p JOIN sources s ON s.id = p.source WHERE s.kind = ? AND s.source_id = ?', [
			kind,
			sourceId
		]) as [number, string, string][]
	).map(([role, name, address]) => ({ role: role as Participant['role'], name, address }));
}

function existingSubject(ctx: JobContext, kind: SourceKind, sourceId: string): string | null {
	const v = ctx.db.selectValue('SELECT p.text FROM parts p JOIN sources s ON s.id = p.source WHERE s.kind = ? AND s.source_id = ? AND p.field = ? LIMIT 1', [
		kind,
		sourceId,
		Field.subject
	]);
	return typeof v === 'string' ? v : null;
}

async function runExtraction(ctx: JobContext, request: ExtractRequest): Promise<Extracted | Coverage> {
	const r = await ctx.extractor.extract(request);
	if (r.ok) return r.value;
	return r.reason === 'timeout' ? Coverage.resourceLimited : Coverage.failed;
}

function fullDocument(
	ctx: JobContext,
	row: QueueRow,
	ex: Extracted,
	size: number,
	extra: { attachments: Attachment[]; attachmentState: Coverage | null; metadata?: SearchDocument['metadataRevision']; date?: number }
): SearchDocument {
	const kind = row.kind as SourceKind;
	const kept = existingParticipants(ctx, kind, row.sourceId);
	const participants = ex.participants.length ? [...ex.participants, ...kept.filter((p) => p.role === Role.deliveredTo)] : kept;
	const attachments: Attachment[] = [...ex.attachments, ...extra.attachments];
	const coverage: SearchDocument['coverage'] = {
		[Dimension.metadata]: Coverage.complete,
		[Dimension.body]: bodyCoverage(ex.outcome)
	};
	if (attachments.length || extra.attachmentState !== null) {
		coverage[Dimension.attachmentMetadata] = extra.attachmentState ?? Coverage.complete;
	}
	if (attachments.some((a) => !a.inline)) coverage[Dimension.attachmentText] = Coverage.pending;
	const draftMeta = extra.metadata !== undefined;
	return {
		kind,
		sourceId: row.sourceId,
		sourceRevision: row.sourceRev,
		contentRevision: row.contentRev,
		metadataRevision: extra.metadata ?? 0,
		threadId: null,
		date: extra.date ?? 0,
		flags: 0,
		knownFlags: draftMeta ? MESSAGE_FLAGS : 0,
		collections: [],
		extraction: 1,
		extractorEpoch: EXTRACTOR_EPOCH,
		size,
		sizeVersion: SIZE_VERSION,
		warnings: ex.warnings,
		messageId: ex.messageId,
		listId: ex.listId,
		subject: ex.subject ?? existingSubject(ctx, kind, row.sourceId),
		participants,
		attachments,
		parts: ex.parts,
		coverage
	};
}

async function extractMessage(ctx: JobContext, row: QueueRow, pointers: Extract<Pointers, { kind: 'message' }>, attempt: number): Promise<BodyResult> {
	if (pointers.body.sizeBytes > MAX_BODY_BYTES) {
		return { row, state: Coverage.resourceLimited, reason: 'size', coverage: [[Dimension.body, Coverage.resourceLimited]] };
	}
	const body = await ctx.bridge!.call({ op: 'body', pointer: pointers.body });
	if (!body.ok) return failureResult(row, body.failure, attempt);
	const separate: Attachment[] = [];
	let attachmentState: Coverage | null = null;
	let separateBytes = 0;
	if (!pointers.attachmentsInBody) {
		for (const a of pointers.attachments) {
			const h: BridgeResult<{ filename: string; contentType: string; inline: boolean; size: number }> = await ctx.bridge!.call({ op: 'attachment', pointer: a.blob });
			if (h.ok) {
				separate.push({ attachmentId: a.id, filename: h.value.filename, mime: h.value.contentType.toLowerCase(), size: h.value.size, inline: a.inline || h.value.inline });
				separateBytes += h.value.size;
				continue;
			}
			if (transient(h.failure) || h.failure.code === 'vault_locked') return failureResult(row, h.failure, attempt);
			attachmentState = h.failure.code === 'locked' ? Coverage.locked : Coverage.failed;
		}
	}
	const ex = await runExtraction(ctx, { kind: 'mime', bytes: body.value.mime });
	if (typeof ex === 'number') return { row, state: ex, reason: 'extract', coverage: [[Dimension.body, ex]] };
	if (ex.outcome === 'malformed') return { row, state: Coverage.failed, reason: 'malformed', coverage: [[Dimension.body, Coverage.failed]] };
	const sizeKnown = attachmentState === null;
	const doc = fullDocument(ctx, row, ex, body.value.storedBytes + separateBytes, { attachments: separate, attachmentState });
	if (!sizeKnown) {
		doc.size = 0;
		doc.sizeVersion = 0;
	}
	return { row, doc, state: bodyCoverage(ex.outcome), reason: ex.outcome === 'complete' ? null : ex.outcome };
}

async function extractDraft(ctx: JobContext, row: QueueRow, pointers: Extract<Pointers, { kind: 'draft' }>, attempt: number): Promise<BodyResult> {
	const draft = await ctx.bridge!.call({ op: 'draft', draftId: row.sourceId, pointer: pointers.body });
	if (!draft.ok) return failureResult(row, draft.failure, attempt);
	const stored = draft.value.storedBytes;
	const ex = await runExtraction(ctx, { kind: 'draft', bytes: draft.value.json });
	if (typeof ex === 'number') return { row, state: ex, reason: 'extract', coverage: [[Dimension.body, ex]] };
	if (ex.outcome === 'malformed') return { row, state: Coverage.failed, reason: 'malformed', coverage: [[Dimension.body, Coverage.failed]] };
	const size = stored + ex.attachments.reduce((n, a) => n + a.size, 0);
	const date = Date.parse(draft.value.updatedAt);
	const doc = fullDocument(ctx, row, ex, size, { attachments: [], attachmentState: null, metadata: row.metadataRev, date: Number.isFinite(date) ? date : 0 });
	return { row, doc, state: bodyCoverage(ex.outcome), reason: ex.outcome === 'complete' ? null : ex.outcome };
}

async function extractOne(ctx: JobContext, row: QueueRow, attempt: number): Promise<BodyResult> {
	const p = row.pointers;
	if (!p) return { row, state: Coverage.pending, reason: 'pointers', redescribe: true };
	if (p.kind === 'message') return extractMessage(ctx, row, p, attempt);
	if (p.kind === 'draft') return extractDraft(ctx, row, p, attempt);
	if (!p.senderCopyMessageId) return { row, state: Coverage.unsupported, reason: null, coverage: [[Dimension.body, Coverage.unsupported]] };
	const copy = ctx.store.get({ kind: QueueKind.message, sourceId: p.senderCopyMessageId });
	if (!copy || copy.state === QueueState.deleted) return { row, state: Coverage.unsupported, reason: 'copy', coverage: [[Dimension.body, Coverage.unsupported]] };
	if (copy.pointers?.kind !== 'message') return { row, state: Coverage.pending, reason: 'copy', defer: { delay: COPY_WAIT_MS, reason: 'copy' } };
	return extractMessage(ctx, row, copy.pointers, attempt);
}

export const bodyJob: JobFactory = (ctx) => {
	let attempt = 0;
	ctx.writer.atomic(() => ctx.store.retryEpoch(EXTRACTOR_EPOCH));
	return {
		name: BODY_JOB,
		class: 'body',
		async step(step) {
			if (!ctx.bridge) return 'idle';
			const batch = ctx.batch(BODY_JOB);
			const results: BodyResult[] = [];
			const taken = new Set<string>();
			let stop = false;
			while (!step.shouldYield() && !batch.full && !stop) {
				const now = ctx.now();
				const rows = ctx.store
					.toExtract(taken.size + DOWNLOADS, now)
					.filter((r) => !taken.has(`${r.kind}:${r.sourceId}`))
					.slice(0, DOWNLOADS);
				if (rows.length === 0) break;
				for (const r of rows) taken.add(`${r.kind}:${r.sourceId}`);
				const done = await Promise.all(rows.map((row) => extractOne(ctx, row, attempt)));
				for (const res of done) {
					if (res.stop) stop = true;
					if (res.defer) attempt++;
					else attempt = 0;
					results.push(res);
					if (res.doc) batch.add(res.doc, null);
					else batch.advance(null);
				}
			}
			const now = ctx.now();
			const committed = await batch.commit(() => {
				for (const res of results) {
					const key = { kind: res.row.kind, sourceId: res.row.sourceId };
					if (res.stop) continue;
					if (res.defer) {
						ctx.store.defer(key, now + res.defer.delay, res.defer.reason);
						continue;
					}
					if (res.redescribe) {
						ctx.store.invalidateOne(key);
						continue;
					}
					ctx.store.extracted(key, res.row.contentRev, res.state, EXTRACTOR_EPOCH, res.reason);
					for (const [dimension, state] of res.coverage ?? []) ctx.writer.setCoverage({ kind: res.row.kind as SourceKind, sourceId: res.row.sourceId }, dimension, state);
				}
			});
			if (!committed.ok) return 'blocked';
			if (results.some((r) => r.redescribe)) ctx.wake(DESCRIBE_JOB);
			const wake = ctx.store.nextWake(now);
			if (wake !== null) ctx.later(BODY_JOB, wake - now);
			if (stop) return 'idle';
			return results.length === 0 ? 'idle' : 'more';
		}
	};
};
