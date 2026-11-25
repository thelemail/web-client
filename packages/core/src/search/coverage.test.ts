import { describe, expect, it } from 'vitest';
import { coverageOf, progressOf } from './coverage';
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

describe('progressOf', () => {
	it('counts the listing step before the inventory is known', () => {
		const s = status([], { phase: 'snapshot', queue: { total: 400, undescribed: 300, held: 0, waiting: 0, bodies: {} } });
		expect(progressOf(s)).toEqual({ state: 'listing', done: 100, total: 400, fraction: 0.25 });
	});

	it('follows message text for a saved index and previews in preview mode', () => {
		const coverage = [
			{ dimension: Dimension.metadata, state: Coverage.complete, count: 80 },
			{ dimension: Dimension.metadata, state: Coverage.pending, count: 20 },
			{ dimension: Dimension.body, state: Coverage.complete, count: 40 },
			{ dimension: Dimension.body, state: Coverage.pending, count: 60 }
		];
		expect(progressOf(status(coverage))).toEqual({ state: 'reading', done: 40, total: 100, fraction: 0.4 });
		expect(progressOf({ ...status(coverage), mode: 'preview' })).toEqual({ state: 'previews', done: 80, total: 100, fraction: 0.8 });
	});

	it('says paused, or that some mail needs attention, while work remains', () => {
		const coverage = [
			{ dimension: Dimension.body, state: Coverage.complete, count: 90 },
			{ dimension: Dimension.body, state: Coverage.pending, count: 7 },
			{ dimension: Dimension.body, state: Coverage.locked, count: 3 }
		];
		expect(progressOf(status(coverage))?.state).toBe('attention');
		expect(progressOf({ ...status(coverage), paused: true })?.state).toBe('paused');
	});

	it('shows nothing once no message is waiting, even if a few could not be read', () => {
		const coverage = [
			{ dimension: Dimension.body, state: Coverage.complete, count: 97 },
			{ dimension: Dimension.body, state: Coverage.failed, count: 3 }
		];
		expect(progressOf(status(coverage))).toBeNull();
		expect(progressOf(null)).toBeNull();
	});

	it('shows the model download, then preparation, once message text is done', () => {
		const coverage = [
			{ dimension: Dimension.body, state: Coverage.complete, count: 100 },
			{ dimension: Dimension.semantic, state: Coverage.pending, count: 100 }
		];
		const downloading = { ...status(coverage), semantic: { state: 'downloading' as const, loaded: 30_000_000, total: 120_000_000 } };
		expect(progressOf(downloading)).toEqual({ state: 'model', done: 30_000_000, total: 120_000_000, fraction: 0.25 });
		expect(progressOf({ ...status(coverage), semantic: { state: 'loading' } })?.state).toBe('preparing');
	});

	it('keeps message text first while it is still being read', () => {
		const coverage = [
			{ dimension: Dimension.body, state: Coverage.complete, count: 40 },
			{ dimension: Dimension.body, state: Coverage.pending, count: 60 }
		];
		expect(progressOf({ ...status(coverage), semantic: { state: 'downloading', loaded: 1, total: 2 } })?.state).toBe('reading');
	});

	it('follows meaning coverage while the model works, and stops when it is done or unavailable', () => {
		const working = [
			{ dimension: Dimension.body, state: Coverage.complete, count: 100 },
			{ dimension: Dimension.semantic, state: Coverage.complete, count: 30 },
			{ dimension: Dimension.semantic, state: Coverage.pending, count: 70 }
		];
		expect(progressOf({ ...status(working), semantic: { state: 'ready' } })).toEqual({ state: 'meaning', done: 30, total: 100, fraction: 0.3 });
		expect(progressOf({ ...status(working), semantic: { state: 'ready' }, paused: true })?.state).toBe('paused');
		expect(progressOf({ ...status(working), semantic: { state: 'unavailable', reason: 'memory' } })).toBeNull();
		expect(progressOf({ ...status(working), semantic: null })).toBeNull();
		const done = [
			{ dimension: Dimension.body, state: Coverage.complete, count: 100 },
			{ dimension: Dimension.semantic, state: Coverage.complete, count: 100 }
		];
		expect(progressOf({ ...status(done), semantic: { state: 'ready' } })).toBeNull();
	});
});
