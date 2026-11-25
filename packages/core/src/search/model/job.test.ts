// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { JobContext } from '../runtime/host';
import type { StepContext } from '../runtime/scheduler';
import { Coverage, Field } from '../sqlite/types';
import { embeddingsJob } from './job';
import type { Acquired, Embedded, ModelLink } from './link';
import type { PendingSource, PassageStore } from './store';

const vector = new Float32Array(384).fill(0.05);
const embedded: Embedded = { ok: true, passages: [{ field: Field.body, attachmentId: null, place: null, refs: [{ part: 1, start: 0, end: 4 }], vector }] };

interface Fakes {
	pending: PendingSource[][];
	acquired?: Acquired;
	embedded?: Embedded;
	live?: boolean;
	unavailableSince?: number | null;
}

function setup(f: Fakes) {
	const puts: unknown[][] = [];
	const marks: unknown[][] = [];
	const later = vi.fn();
	const store = {
		unavailableSince: () => f.unavailableSince ?? null,
		setUnavailable: vi.fn(),
		adopt: vi.fn((epoch: number) => epoch > 0),
		seed: vi.fn(() => 0),
		pending: vi.fn(() => f.pending.shift() ?? []),
		input: vi.fn(() => ({ subject: null, parts: [] })),
		put: vi.fn((...args: unknown[]) => {
			puts.push(args);
			return true;
		}),
		mark: vi.fn((...args: unknown[]) => {
			marks.push(args);
			return true;
		}),
		retryFailed: vi.fn()
	};
	const link = {
		state: { state: 'idle' },
		fence: 4,
		acquire: vi.fn(async () => f.acquired ?? { ok: true }),
		embed: vi.fn(async () => f.embedded ?? embedded),
		check: vi.fn(async () => f.live ?? true),
		idleSoon: vi.fn(),
		unavailable: vi.fn()
	};
	const ctx = {
		model: link as unknown as ModelLink,
		passages: store as unknown as PassageStore,
		admit: async () => ({ ok: true }),
		now: () => 1_000_000,
		later,
		wake: vi.fn()
	} as unknown as JobContext;
	return { job: embeddingsJob(ctx), store, link, puts, marks, later };
}

const step: StepContext = { signal: new AbortController().signal, shouldYield: () => false };

describe('embeddingsJob', () => {
	it('embeds pending sources newest first and stores them under the current epoch', async () => {
		const { job, puts, store } = setup({ pending: [[{ id: 1, contentRev: 3, body: Coverage.complete }], []] });
		expect(await job.step(step)).toBe('idle');
		expect(store.adopt).toHaveBeenCalledWith(expect.any(Number));
		expect(puts).toEqual([[1, 3, store.adopt.mock.calls[0][0], (embedded as Extract<Embedded, { ok: true }>).passages]]);
	});

	it('discards a result when the lease is gone after inference, as after a lock or account switch', async () => {
		const { job, puts } = setup({ pending: [[{ id: 1, contentRev: 3, body: Coverage.complete }], []], live: false });
		expect(await job.step(step)).toBe('more');
		expect(puts).toEqual([]);
	});

	it('copies a body that cannot be read into the semantic dimension', async () => {
		const { job, marks, link } = setup({ pending: [[{ id: 2, contentRev: 1, body: Coverage.locked }], []] });
		expect(await job.step(step)).toBe('idle');
		expect(marks).toEqual([[2, 1, Coverage.locked]]);
		expect(link.acquire).not.toHaveBeenCalled();
	});

	it('marks a message over the passage limit as too large', async () => {
		const { job, marks } = setup({ pending: [[{ id: 1, contentRev: 3, body: Coverage.complete }], []], embedded: { ok: false, reason: 'tooMany' } });
		expect(await job.step(step)).toBe('idle');
		expect(marks).toEqual([[1, 3, Coverage.resourceLimited]]);
	});

	it('waits for another account to finish', async () => {
		const { job, later, link } = setup({ pending: [[{ id: 1, contentRev: 3, body: Coverage.complete }]], acquired: { ok: false, retryMs: 5000 } });
		expect(await job.step(step)).toBe('idle');
		expect(later).toHaveBeenCalledWith('embeddings', 5000);
		expect(link.embed).not.toHaveBeenCalled();
	});

	it('remembers a device that cannot hold the model and keeps away for a week', async () => {
		const first = setup({ pending: [[{ id: 1, contentRev: 3, body: Coverage.complete }]], acquired: { ok: false, unavailable: 'memory' } });
		expect(await first.job.step(step)).toBe('idle');
		expect(first.store.setUnavailable).toHaveBeenCalledWith(1_000_000);
		const later = setup({ pending: [[{ id: 1, contentRev: 3, body: Coverage.complete }]], unavailableSince: 999_000 });
		expect(await later.job.step(step)).toBe('idle');
		expect(later.link.acquire).not.toHaveBeenCalled();
		expect(later.link.unavailable).toHaveBeenCalledWith('memory');
	});

	it('lets the model go after a quiet spell when nothing is left', async () => {
		const { job, link } = setup({ pending: [[]] });
		expect(await job.step(step)).toBe('idle');
		expect(link.idleSoon).toHaveBeenCalled();
	});

	it('clears the device mark and failed sources on retry', () => {
		const { job, store } = setup({ pending: [] });
		job.receive?.('retry');
		expect(store.setUnavailable).toHaveBeenCalledWith(null);
		expect(store.retryFailed).toHaveBeenCalled();
	});
});
