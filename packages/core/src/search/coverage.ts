import type { SearchStatus } from './runtime/protocol';
import { Coverage, Dimension } from './sqlite/types';

export type Gap = 'waiting' | 'locked' | 'failed' | 'tooLarge' | 'unsupported';

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
	[Coverage.unsupported]: 'unsupported'
};

export const SHOWN_DIMENSIONS: readonly Dimension[] = [Dimension.metadata, Dimension.body, Dimension.attachmentMetadata];

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
