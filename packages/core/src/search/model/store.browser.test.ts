import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Harness, document } from '../sqlite/harness';
import type { PassageMethod } from '../sqlite/harness.worker';
import { Coverage, Dimension, Field, SourceKind } from '../sqlite/types';
import { DIMENSIONS, VECTOR_BYTES } from './pool';
import type { EmbeddedPassage } from './protocol';
import type { PendingSource } from './store';

const EPOCH = 123_456;
let h: Harness;

function store<T>(method: PassageMethod, ...args: unknown[]): Promise<T> {
	return h.call<T>({ op: 'passages', method, args });
}

function passage(fill: number, part: number): EmbeddedPassage {
	const vector = new Float32Array(DIMENSIONS).fill(fill);
	return { field: Field.body, attachmentId: null, place: null, refs: [{ part, start: 0, end: 5 }], vector };
}

async function idOf(sourceId: string): Promise<number> {
	const [[id]] = await h.select<[number]>('SELECT id FROM sources WHERE source_id = ?', [sourceId]);
	return id;
}

async function semantic(sourceId: string): Promise<number | null> {
	const rows = await h.select<[number]>('SELECT c.state FROM coverage c JOIN sources s ON s.id = c.source WHERE s.source_id = ? AND c.dimension = ?', [sourceId, Dimension.semantic]);
	return rows[0]?.[0] ?? null;
}

beforeEach(async () => {
	h = new Harness();
	await h.call({ op: 'memory' });
	await store('adopt', EPOCH);
});

afterEach(() => h.terminate());

describe('passage store', () => {
	it('seeds a semantic row for every source with body coverage and picks only settled ones', async () => {
		await h.call({ op: 'put', doc: document('ready') });
		await h.call({ op: 'put', doc: document('reading', { coverage: { [Dimension.metadata]: Coverage.complete, [Dimension.body]: Coverage.pending } }) });
		await h.call({ op: 'put', doc: document('locked', { coverage: { [Dimension.metadata]: Coverage.complete, [Dimension.body]: Coverage.locked } }) });
		await h.call({ op: 'put', doc: document('files', { coverage: { [Dimension.metadata]: Coverage.complete, [Dimension.body]: Coverage.complete, [Dimension.attachmentText]: Coverage.pending } }) });
		await h.call({ op: 'put', doc: document('bare', { coverage: { [Dimension.metadata]: Coverage.complete } }) });
		expect(await store('seed')).toBe(4);
		expect(await store('seed')).toBe(0);
		const pending = await store<PendingSource[]>('pending', 10);
		expect(pending.map((p) => p.body).sort()).toEqual([Coverage.complete, Coverage.locked].sort());
		expect(await semantic('bare')).toBeNull();
	});

	it('reads prose parts with their row ids and the subject', async () => {
		await h.call({
			op: 'put',
			doc: document('m', {
				subject: 'Budget',
				parts: [
					{ field: Field.body, text: 'Body text.' },
					{ field: Field.identifier, text: 'ABC-1' },
					{ field: Field.quoted, text: 'Quoted text.' }
				]
			})
		});
		const input = await store<{ subject: string; parts: { ordinal: number; field: number; text: string }[] }>('input', await idOf('m'));
		expect(input.subject).toBe('Budget');
		expect(input.parts.map((p) => [p.field, p.text])).toEqual([
			[Field.body, 'Body text.'],
			[Field.quoted, 'Quoted text.']
		]);
		const [[partId]] = await h.select<[number]>('SELECT id FROM parts WHERE text = ?', ['Body text.']);
		expect(input.parts[0].ordinal).toBe(partId);
	});

	it('stores fp16 vectors with their source mapping and completes coverage', async () => {
		await h.call({ op: 'put', doc: document('m') });
		await store('seed');
		const id = await idOf('m');
		expect(await store('put', id, 1, EPOCH, [passage(0.5, 7), passage(0.25, 8)])).toBe(true);
		const rows = await h.select<[number, number, Uint8Array]>('SELECT ordinal, epoch, vector FROM passages WHERE source = ? ORDER BY ordinal', [id]);
		expect(rows.map(([o, e, v]) => [o, e, v.length])).toEqual([
			[0, EPOCH, VECTOR_BYTES],
			[1, EPOCH, VECTOR_BYTES]
		]);
		expect(await h.select('SELECT ordinal, part FROM passage_refs WHERE source = ? ORDER BY ordinal', [id])).toEqual([
			[0, 7],
			[1, 8]
		]);
		expect(await semantic('m')).toBe(Coverage.complete);
	});

	it('drops a result for an older revision or another epoch', async () => {
		await h.call({ op: 'put', doc: document('m') });
		await store('seed');
		const id = await idOf('m');
		expect(await store('put', id, 0, EPOCH, [passage(0.5, 1)])).toBe(false);
		expect(await store('put', id, 1, EPOCH + 1, [passage(0.5, 1)])).toBe(false);
		expect(await store('count')).toBe(0);
	});

	it('forgets passages when the body or attachment text changes, or the source is deleted', async () => {
		await h.call({ op: 'put', doc: document('m') });
		await store('seed');
		await store('put', await idOf('m'), 1, EPOCH, [passage(0.5, 1)]);
		await h.call({ op: 'put', doc: document('m', { contentRevision: 2 }) });
		expect(await store('count')).toBe(0);
		expect(await semantic('m')).toBeNull();

		await store('seed');
		await store('put', await idOf('m'), 2, EPOCH, [passage(0.5, 1)]);
		await h.call({ op: 'putAttachmentText', key: { kind: SourceKind.message, sourceId: 'm' }, text: { contentRevision: 2, attachmentId: 'a', parts: [{ text: 'Invoice', place: 'page:1' }] } });
		expect(await store('count')).toBe(0);

		await store('seed');
		await store('put', await idOf('m'), 2, EPOCH, [passage(0.5, 1)]);
		await h.call({ op: 'delete', key: { kind: SourceKind.message, sourceId: 'm' } });
		expect(await h.select('SELECT count(*) FROM passage_refs')).toEqual([[0]]);
		expect(await store('count')).toBe(0);
	});

	it('starts over on a new epoch and wipes everything when switched off', async () => {
		await h.call({ op: 'put', doc: document('m') });
		await store('seed');
		await store('put', await idOf('m'), 1, EPOCH, [passage(0.5, 1)]);
		expect(await store('adopt', EPOCH)).toBe(false);
		expect(await store('adopt', EPOCH + 1)).toBe(true);
		expect(await store('count')).toBe(0);
		expect(await semantic('m')).toBeNull();
		await store('seed');
		expect(await store('clear')).toBe(true);
		expect(await semantic('m')).toBeNull();
		expect(await store('clear')).toBe(false);
	});

	it('retries failed sources but not ones over the limit', async () => {
		await h.call({ op: 'put', doc: document('a') });
		await h.call({ op: 'put', doc: document('b') });
		await store('seed');
		await store('mark', await idOf('a'), 1, Coverage.failed);
		await store('mark', await idOf('b'), 1, Coverage.resourceLimited);
		await store('retryFailed');
		expect(await semantic('a')).toBe(Coverage.pending);
		expect(await semantic('b')).toBe(Coverage.resourceLimited);
	});
});
