import type { SearchStatus } from './runtime/protocol';
import { Coverage, Dimension } from './sqlite/types';

export type Gap = 'waiting' | 'locked' | 'failed' | 'tooLarge' | 'unsupported' | 'password' | 'partial' | 'timeout';

export interface DimensionCoverage {
	dimension: Dimension;
	total: number;
	done: number;
	excluded: number;
	gaps: Partial<Record<Gap, number>>;
}

export interface CoverageView {
	dimensions: DimensionCoverage[];
	inventoryDone: boolean;
	complete: boolean;
	syncedAt: number | null;
	waitingOn: string | null;
}

const GAP_OF: Partial<Record<Coverage, Gap>> = {
	[Coverage.pending]: 'waiting',
	[Coverage.processing]: 'waiting',
	[Coverage.locked]: 'locked',
	[Coverage.failed]: 'failed',
	[Coverage.resourceLimited]: 'tooLarge',
	[Coverage.unsupported]: 'unsupported',
	[Coverage.passwordRequired]: 'password',
	[Coverage.partial]: 'partial',
	[Coverage.timeout]: 'timeout'
};

export const SHOWN_DIMENSIONS: readonly Dimension[] = [Dimension.metadata, Dimension.body, Dimension.attachmentMetadata, Dimension.attachmentText, Dimension.semantic];

export function coverageOf(status: SearchStatus | null, relevant: readonly Dimension[]): CoverageView {
	const sync = status?.sync ?? null;
	const inventoryDone = sync?.phase === 'live' && sync.queue.undescribed === 0;
	const byDimension = new Map<Dimension, DimensionCoverage>();
	for (const c of sync?.coverage ?? []) {
		if (c.state === Coverage.deleted) continue;
		let d = byDimension.get(c.dimension);
		if (!d) {
			d = { dimension: c.dimension, total: 0, done: 0, excluded: 0, gaps: {} };
			byDimension.set(c.dimension, d);
		}
		d.total += c.count;
		if (c.state === Coverage.complete) d.done += c.count;
		else if (c.state === Coverage.excludedByUser) d.excluded += c.count;
		else {
			const gap = GAP_OF[c.state] ?? 'waiting';
			d.gaps[gap] = (d.gaps[gap] ?? 0) + c.count;
		}
	}
	const dimensions = [...byDimension.values()].sort((a, b) => a.dimension - b.dimension);
	const wanted = relevant.length ? relevant : [Dimension.metadata];
	const complete =
		!!status &&
		inventoryDone &&
		wanted.every((dim) => {
			const d = byDimension.get(dim);
			return !d || d.done + d.excluded === d.total;
		});
	return { dimensions, inventoryDone, complete, syncedAt: sync?.syncedAt ?? null, waitingOn: sync?.waiting ?? null };
}

export type ProgressState = 'listing' | 'previews' | 'reading' | 'paused' | 'attention' | 'model' | 'preparing' | 'meaning';

export interface Progress {
	state: ProgressState;
	done: number;
	total: number;
	fraction: number;
}

export function progressOf(status: SearchStatus | null): Progress | null {
	const sync = status?.sync;
	if (!status || !sync) return null;
	const view = coverageOf(status, []);
	if (!view.inventoryDone) {
		const total = sync.queue.total;
		const done = Math.max(0, total - sync.queue.undescribed);
		return { state: status.paused ? 'paused' : 'listing', done, total, fraction: total ? done / total : 0 };
	}
	const preview = status.mode === 'preview';
	const d = view.dimensions.find((x) => x.dimension === (preview ? Dimension.metadata : Dimension.body));
	if (d?.total && d.gaps.waiting) {
		const done = d.done + d.excluded;
		const state: ProgressState = status.paused ? 'paused' : d.gaps.locked || d.gaps.failed ? 'attention' : preview ? 'previews' : 'reading';
		return { state, done, total: d.total, fraction: done / d.total };
	}
	return preview ? null : meaningProgress(status, view);
}

function meaningProgress(status: SearchStatus, view: CoverageView): Progress | null {
	const engine = status.semantic;
	if (!engine || engine.state === 'unavailable') return null;
	if (engine.state === 'downloading') {
		return { state: 'model', done: engine.loaded, total: engine.total, fraction: engine.total ? Math.min(1, engine.loaded / engine.total) : 0 };
	}
	if (engine.state === 'loading') return { state: 'preparing', done: 0, total: 0, fraction: 1 };
	const d = view.dimensions.find((x) => x.dimension === Dimension.semantic);
	if (!d?.total || !d.gaps.waiting) return null;
	const done = d.done + d.excluded;
	return { state: status.paused ? 'paused' : 'meaning', done, total: d.total, fraction: done / d.total };
}
