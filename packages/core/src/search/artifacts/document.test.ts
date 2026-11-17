import { describe, expect, it } from 'vitest';
import { EXTRACTOR_EPOCH, FILE_EXTRACTOR_EPOCH } from '../extract/epochs';
import { Coverage, Field, Role } from '../sqlite/types';
import { DocumentError, decodeDocument, encodeDocument, type DocumentPayload } from './document';

function payload(): DocumentPayload {
	return {
		extractorEpoch: EXTRACTOR_EPOCH,
		size: 12_000,
		sizeVersion: 1,
		warnings: 0,
		messageId: '<a@calloway.test>',
		listId: null,
		subject: 'Quarterly numbers',
		participants: [
			{ role: Role.from, name: 'Ada Calloway', address: 'ada@calloway.test' },
			{ role: Role.to, name: '', address: 'ben@calloway.test' }
		],
		attachments: [
			{ attachmentId: 'a1', filename: 'q3.pdf', mime: 'application/pdf', size: 9000 },
			{ attachmentId: 'a2', filename: 'logo.png', mime: 'image/png', size: 300, inline: true }
		],
		parts: [
			{ field: Field.body, text: 'Numbers attached.' },
			{ field: Field.attachmentText, text: 'Revenue grew', attachmentId: 'a1', locator: 0, place: 'p1' }
		],
		attachmentStates: [{ attachmentId: 'a1', state: Coverage.complete, epoch: FILE_EXTRACTOR_EPOCH }],
		body: Coverage.complete,
		attachmentMetadata: Coverage.complete
	};
}

function wire(change: (w: Record<string, unknown>) => void): Uint8Array {
	const w = JSON.parse(new TextDecoder().decode(encodeDocument(payload())));
	change(w);
	return new TextEncoder().encode(JSON.stringify(w));
}

describe('document payload', () => {
	it('round-trips every field', () => {
		expect(decodeDocument(encodeDocument(payload()))).toEqual(payload());
	});

	it('keeps the text of all attachments in the one document', () => {
		const p = payload();
		p.attachments = Array.from({ length: 5 }, (_, i) => ({ attachmentId: `a${i}`, filename: `f${i}.pdf`, mime: 'application/pdf', size: 10 }));
		p.parts = p.attachments.map((a) => ({ field: Field.attachmentText, text: `text ${a.attachmentId}`, attachmentId: a.attachmentId, locator: 0 }));
		p.attachmentStates = p.attachments.map((a) => ({ attachmentId: a.attachmentId, state: Coverage.complete, epoch: FILE_EXTRACTOR_EPOCH }));
		expect(decodeDocument(encodeDocument(p)).parts).toHaveLength(5);
	});

	it.each([
		['a newer format', (w: Record<string, unknown>) => (w.v = 2)],
		['another extractor epoch', (w: Record<string, unknown>) => (w.e = EXTRACTOR_EPOCH + 1)],
		['a body that was not extracted', (w: Record<string, unknown>) => (w.b = Coverage.failed)],
		['an unknown role', (w: Record<string, unknown>) => ((w.p as unknown[][])[0][0] = 99)],
		['a part for an unknown attachment', (w: Record<string, unknown>) => ((w.t as unknown[][])[1][2] = 'zz')],
		['a subject part', (w: Record<string, unknown>) => ((w.t as unknown[][])[0][0] = Field.subject)],
		['a negative size', (w: Record<string, unknown>) => (w.s = -1)],
		['a newer file epoch', (w: Record<string, unknown>) => ((w.q as unknown[][])[0][2] = FILE_EXTRACTOR_EPOCH + 1)],
		['a missing field', (w: Record<string, unknown>) => delete w.t]
	])('rejects %s', (_, change) => {
		expect(() => decodeDocument(wire(change))).toThrow(DocumentError);
	});

	it('rejects bytes that are not JSON', () => {
		expect(() => decodeDocument(new Uint8Array([0xff, 0xfe]))).toThrow(DocumentError);
	});

	it('sends an attachment from an older file extractor back to the queue', () => {
		const out = decodeDocument(wire((w) => ((w.q as unknown[][])[0][2] = FILE_EXTRACTOR_EPOCH - 1)));
		expect(out.attachmentStates[0]).toEqual({ attachmentId: 'a1', state: Coverage.pending, epoch: 0 });
	});
});
