import { describe, expect, it } from 'vitest';
import { coverageOf } from './coverage';
import type { SearchStatus } from './runtime/protocol';
import { Coverage, Dimension } from './sqlite/types';

function status(coverage: { dimension: Dimension; state: Coverage; count: number }[], over: Partial<NonNullable<SearchStatus['sync']>> = {}): SearchStatus {
	return {
		persistence: 'persistent',
		mode: 'saved',
		limited: null,
		sources: 100,
		working: null,
		paused: false,
		generation: 0,
		sync: {
			phase: 'live',
			seq: 10,
			syncedAt: 1_000,
			waiting: null,
			queue: { total: 100, undescribed: 0, held: 0, waiting: 0, bodies: {} },
			coverage,
			...over
		}
	};
}

describe('coverageOf', () => {
	it('is complete only when every relevant dimension is done', () => {
		const s = status([
			{ dimension: Dimension.metadata, state: Coverage.complete, count: 100 },
			{ dimension: Dimension.body, state: Coverage.complete, count: 90 },
			{ dimension: Dimension.body, state: Coverage.pending, count: 10 }
		]);
		expect(coverageOf(s, [Dimension.metadata]).complete).toBe(true);
		expect(coverageOf(s, [Dimension.metadata, Dimension.body]).complete).toBe(false);
	});

	it('groups incomplete sources by reason', () => {
		const s = status([
			{ dimension: Dimension.body, state: Coverage.complete, count: 18_420 },
			{ dimension: Dimension.body, state: Coverage.locked, count: 12 },
			{ dimension: Dimension.body, state: Coverage.failed, count: 3 },
			{ dimension: Dimension.body, state: Coverage.resourceLimited, count: 1 },
			{ dimension: Dimension.body, state: Coverage.processing, count: 4 },
			{ dimension: Dimension.body, state: Coverage.deleted, count: 50 }
		]);
		const body = coverageOf(s, [Dimension.body]).dimensions.find((d) => d.dimension === Dimension.body)!;
		expect(body).toEqual({
			dimension: Dimension.body,
			total: 18_440,
			done: 18_420,
			excluded: 0,
			gaps: { locked: 12, failed: 3, tooLarge: 1, waiting: 4 }
		});
	});

	it('counts excluded sources as covered by choice', () => {
		const s = status([
			{ dimension: Dimension.attachmentText, state: Coverage.complete, count: 2 },
			{ dimension: Dimension.attachmentText, state: Coverage.excludedByUser, count: 8 }
		]);
		expect(coverageOf(s, [Dimension.attachmentText]).complete).toBe(true);
	});

	it('is never complete before the mailbox inventory is known', () => {
		const done = [{ dimension: Dimension.metadata, state: Coverage.complete, count: 5 }];
		expect(coverageOf(status(done, { phase: 'snapshot' }), [Dimension.metadata]).complete).toBe(false);
		expect(coverageOf(status(done, { queue: { total: 9, undescribed: 4, held: 0, waiting: 0, bodies: {} } }), [Dimension.metadata]).complete).toBe(false);
		expect(coverageOf(null, [Dimension.metadata]).complete).toBe(false);
	});
});
