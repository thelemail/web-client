import type { SearchArtifactKey, SearchArtifactUploadItem } from '../../api/types';
import type { SearchArtifactRef } from '../../keystore/protocol';
import { RECORD_BYTES } from '../model/job';
import type { EmbeddedPassage } from '../model/protocol';
import type { JobContext, JobFactory } from '../runtime/host';
import type { StepOutcome } from '../runtime/scheduler';
import { backoffDelay } from '../sync/backoff';
import type { BridgeFailure } from '../sync/protocol';
import { ArtifactState } from '../sync/store';
import { UUID_RE, VECTOR_HYDRATE_JOB, VECTOR_UPLOAD_JOB, retryAfter, sha256 } from './jobs';
import { IndexState, type VectorRow } from './store';
import { VectorsError, decodeVectors, encodeVectors, localParts, partsDigest, readVectors, toLocal } from './vectors';

function vectorsRef(sourceId: string, contentRevision: number, componentEpoch: number, extractionRevision: number): SearchArtifactRef {
	return { kind: 'vectors', sourceKind: 'message', sourceId, contentRevision, componentEpoch, extractionRevision };
}

function vectorsKey(sourceId: string, contentRevision: number, componentEpoch: number): SearchArtifactKey {
	return { kind: 'vectors', sourceKind: 'message', sourceId, contentRevision, componentEpoch };
}

async function usable(ctx: JobContext, payload: Uint8Array, source: number, epoch: number): Promise<EmbeddedPassage[] | null> {
	let decoded;
	try {
		decoded = decodeVectors(payload);
	} catch (error) {
		if (!(error instanceof VectorsError)) throw error;
		return null;
	}
	if (decoded.epoch !== epoch) return null;
	const parts = localParts(ctx.db, source);
	if (decoded.digest !== (await partsDigest(parts))) return null;
	return toLocal(decoded, parts);
}

export const vectorHydrateJob: JobFactory = (ctx) => {
	let attempt = 0;

	const wait = (f: BridgeFailure): StepOutcome => {
		if (f.code === 'generation' || f.code === 'vault_locked') return 'idle';
		ctx.later(VECTOR_HYDRATE_JOB, backoffDelay(attempt++, retryAfter(f)));
		return 'idle';
	};

	const reject = (row: VectorRow, epoch: number) => {
		ctx.writer.atomic(() => ctx.artifacts.markVectors(row.sourceId, epoch, IndexState.rejected));
		ctx.wake('embeddings');
	};

	return {
		name: VECTOR_HYDRATE_JOB,
		class: 'embeddings',
		receive() {
			ctx.wake(VECTOR_HYDRATE_JOB);
		},
		async step(step) {
			const s = ctx.sync();
			const store = ctx.passages;
			if (!s || !s.listed || !ctx.bridge || !ctx.model || !store) return 'idle';
			while (!step.shouldYield()) {
				const epoch = store.target();
				if (epoch === null) return 'idle';
				const rows = ctx.artifacts.vectorsToHydrate(epoch, s.limits.batchItems);
				if (rows.length === 0) return 'idle';
				const r = await ctx.bridge.call({ op: 'artifactFetch', generationId: s.generationId, keys: rows.map((row) => vectorsKey(row.sourceId, row.contentRev, epoch)) });
				if (ctx.sync() !== s) return 'idle';
				if (!r.ok) return wait(r.failure);
				attempt = 0;
				const waiting = new Map(rows.map((row) => [row.sourceId, row]));
				for (const { item, bytes } of r.value) {
					const row = waiting.get(item.sourceId);
					if (!row || item.kind !== 'vectors' || item.contentRevision !== row.contentRev || item.componentEpoch !== epoch) continue;
					if (item.status === 'deferred') continue;
					waiting.delete(item.sourceId);
					if (item.status === 'gone' || !bytes || item.extractionRevision === undefined) {
						ctx.writer.atomic(() => ctx.artifacts.dropVectors(row.sourceId, epoch));
						ctx.wake('embeddings');
						continue;
					}
					const opened = await s.open(vectorsRef(row.sourceId, row.contentRev, epoch, item.extractionRevision), bytes);
					if (ctx.sync() !== s) return 'idle';
					if (!opened.ok) {
						if (opened.code === 'unavailable') return 'idle';
						reject(row, epoch);
						continue;
					}
					const passages = await usable(ctx, opened.payload, row.source, epoch);
					if (!passages) {
						reject(row, epoch);
						continue;
					}
					const admitted = await ctx.admit(passages.length * RECORD_BYTES);
					if (!admitted.ok) return 'blocked';
					if (ctx.sync() !== s) return 'idle';
					ctx.writer.atomic(() => {
						store.put(row.source, row.contentRev, epoch, passages, item.extractionRevision!);
						ctx.artifacts.markVectors(row.sourceId, epoch, IndexState.hydrated);
					});
				}
				if (waiting.size) {
					ctx.later(VECTOR_HYDRATE_JOB, backoffDelay(attempt++, null));
					return 'idle';
				}
				ctx.wake('embeddings');
			}
			return 'more';
		}
	};
};

export const vectorUploadJob: JobFactory = (ctx) => {
	let attempt = 0;
	ctx.writer.atomic(() => ctx.artifacts.recoverVectors());

	return {
		name: VECTOR_UPLOAD_JOB,
		class: 'artifacts',
		receive() {
			ctx.wake(VECTOR_UPLOAD_JOB);
		},
		async step(step) {
			const s = ctx.sync();
			const store = ctx.passages;
			if (!s || !s.listed || s.full || !ctx.bridge || !ctx.model || !store) return 'idle';
			const epoch = store.target();
			if (epoch === null) return 'idle';
			const now = ctx.now();
			const rows = ctx.artifacts.vectorsToUpload(epoch, s.limits.batchItems, now).filter((r) => UUID_RE.test(r.sourceId));
			if (rows.length === 0) {
				const at = ctx.artifacts.nextVectorUpload(epoch, now);
				if (at !== null) ctx.later(VECTOR_UPLOAD_JOB, at - now);
				return 'idle';
			}
			ctx.writer.atomic(() => ctx.artifacts.claimVectors(rows));
			const items: { item: SearchArtifactUploadItem; bytes: Uint8Array }[] = [];
			const bySource = new Map<string, VectorRow>();
			const local: VectorRow[] = [];
			const skipped: VectorRow[] = [];
			let bytes = 0;
			let keyless = false;
			for (const row of rows) {
				if (keyless || (step.shouldYield() && items.length)) {
					skipped.push(row);
					continue;
				}
				const payload = await readVectors(ctx.db, epoch, row.source);
				if (ctx.sync() !== s) return 'idle';
				if (!payload) {
					local.push(row);
					continue;
				}
				const ref = vectorsRef(row.sourceId, row.contentRev, epoch, row.rev + 1);
				const sealed = await s.seal(ref, encodeVectors(payload));
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
				bySource.set(row.sourceId, row);
				items.push({ item: { ...ref, length: n, sha256: await sha256(sealed.artifact) }, bytes: sealed.artifact });
			}
			const done = ctx.now();
			ctx.writer.atomic(() => {
				for (const row of local) ctx.artifacts.settleVectors(row.source, ArtifactState.localOnly);
				for (const row of skipped) ctx.artifacts.deferVectors(row.source, 0);
			});
			if (items.length === 0) return !keyless && (local.length || skipped.length) ? 'more' : 'idle';
			const r = await ctx.bridge.call(
				{ op: 'artifactUpload', generationId: s.generationId, items },
				items.map((i) => i.bytes.buffer as ArrayBuffer)
			);
			if (ctx.sync() !== s) return 'idle';
			if (!r.ok) {
				const delay = backoffDelay(attempt++, retryAfter(r.failure));
				const transient = r.failure.code === 'retry' || r.failure.code === 'pending';
				if (r.failure.code === 'full') s.full = true;
				ctx.writer.atomic(() => {
					for (const row of bySource.values()) ctx.artifacts.deferVectors(row.source, transient ? done + delay : 0);
				});
				if (transient) ctx.later(VECTOR_UPLOAD_JOB, delay);
				return 'idle';
			}
			attempt = 0;
			ctx.writer.atomic(() => {
				for (const res of r.value.results) {
					const row = res.kind === 'vectors' ? bySource.get(res.sourceId) : undefined;
					if (!row) continue;
					bySource.delete(res.sourceId);
					if (res.status === 'stored' || res.status === 'exists') ctx.artifacts.uploadedVectors(row.source, res.extractionRevision);
					else ctx.artifacts.settleVectors(row.source, ArtifactState.clean);
				}
				for (const row of bySource.values()) ctx.artifacts.deferVectors(row.source, done + backoffDelay(0, null));
			});
			return keyless ? 'idle' : 'more';
		}
	};
};
