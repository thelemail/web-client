import { describe, expect, it } from 'vitest';
import type { SearchWriter } from '../sqlite/writer';
import { Coverage, Dimension, Field, Flag, Role, SourceKind, type SearchDocument } from '../sqlite/types';
import { BATCH_BYTES, BATCH_SOURCES, Batch, textSize } from './batch';

function doc(id: string, body = 'body'): SearchDocument {
	return {
		kind: SourceKind.message,
		sourceId: id,
		contentRevision: 1,
		metadataRevision: 1,
		threadId: null,
		messageId: null,
		date: 0,
		size: 0,
		flags: Flag.inbox,
		knownFlags: Flag.inbox,
		collections: [],
		subject: 'subject',
		participants: [{ role: Role.from, name: 'Ada', address: 'ada@calloway.test' }],
		attachments: [{ attachmentId: 'a', filename: 'notes.txt', mime: 'text/plain', size: 1 }],
		parts: [{ field: Field.body, text: body }],
		coverage: { [Dimension.body]: Coverage.complete }
	};
}

interface Call {
	ids: string[];
	job: string;
	cursor: string | null;
}

function fakeWriter(fail?: () => unknown) {
	const calls: Call[] = [];
	let saved: string | null = null;
	const writer = {
		putBatch(docs: readonly SearchDocument[], checkpoint: { job: string; cursor: string | null }) {
			const error = fail?.();
			if (error) throw error;
			calls.push({ ids: docs.map((d) => d.sourceId), ...checkpoint });
			saved = checkpoint.cursor;
			return docs.map(() => 'inserted' as const);
		},
		checkpoint: () => saved
	} as unknown as SearchWriter;
	return { writer, calls };
}

const admitAll = async () => ({ ok: true }) as const;

describe('textSize', () => {
	it('counts subject, participants, filenames and parts', () => {
		expect(textSize(doc('m1', 'hello'))).toBe('subject'.length + 'Ada'.length + 'ada@calloway.test'.length + 'notes.txt'.length + 5);
	});
});

describe('Batch', () => {
	it('is full at 250 sources', () => {
		const { writer } = fakeWriter();
		const batch = new Batch(writer, 'body', admitAll);
		for (let i = 0; i < BATCH_SOURCES - 1; i++) expect(batch.add(doc(`m${i}`), String(i))).toBe(false);
		expect(batch.add(doc('last'), 'last')).toBe(true);
	});

	it('is full at 2 MiB of text', () => {
		const { writer } = fakeWriter();
		const batch = new Batch(writer, 'body', admitAll);
		expect(batch.add(doc('m1', 'x'.repeat(BATCH_BYTES / 2)), '1')).toBe(false);
		expect(batch.add(doc('m2', 'x'.repeat(BATCH_BYTES / 2)), '2')).toBe(true);
	});

	it('commits the documents with the last cursor and starts empty again', async () => {
		const { writer, calls } = fakeWriter();
		const batch = new Batch(writer, 'body', admitAll);
		batch.add(doc('m1'), 'c1');
		batch.add(doc('m2'), 'c2');
		expect(await batch.commit()).toEqual({ ok: true, results: ['inserted', 'inserted'] });
		expect(calls).toEqual([{ ids: ['m1', 'm2'], job: 'body', cursor: 'c2' }]);
		expect(batch.size).toBe(0);
		expect(batch.resume()).toBe('c2');
		expect(await batch.commit()).toEqual({ ok: true, results: [] });
		expect(calls).toHaveLength(1);
	});

	it('commits a cursor that moved without documents', async () => {
		const { writer, calls } = fakeWriter();
		const batch = new Batch(writer, 'body', admitAll);
		batch.advance('c9');
		await batch.commit();
		expect(calls).toEqual([{ ids: [], job: 'body', cursor: 'c9' }]);
	});

	it('writes nothing when admission is refused and keeps the batch', async () => {
		const { writer, calls } = fakeWriter();
		let allow = false;
		const batch = new Batch(writer, 'body', async () => (allow ? { ok: true } : { ok: false, reason: 'quota' }));
		batch.add(doc('m1'), 'c1');
		expect(await batch.commit()).toEqual({ ok: false, reason: 'quota' });
		expect(calls).toEqual([]);
		allow = true;
		expect(await batch.commit()).toEqual({ ok: true, results: ['inserted'] });
	});

	it('turns a full disk during the write into a quota refusal', async () => {
		const { writer } = fakeWriter(() => Object.assign(new Error('full'), { resultCode: 13 }));
		const batch = new Batch(writer, 'body', admitAll);
		batch.add(doc('m1'), 'c1');
		expect(await batch.commit()).toEqual({ ok: false, reason: 'quota' });
		expect(batch.size).toBe(1);
	});

	it('rethrows other write errors', async () => {
		const { writer } = fakeWriter(() => new Error('corrupt'));
		const batch = new Batch(writer, 'body', admitAll);
		batch.add(doc('m1'), 'c1');
		await expect(batch.commit()).rejects.toThrow('corrupt');
	});
});
