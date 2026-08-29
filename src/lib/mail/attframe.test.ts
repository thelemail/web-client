import { describe, it, expect } from 'vitest';
import { build, parse, parseHeaderPrefix } from './attframe';

const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function frame(): Uint8Array {
	return build(
		{ filename: 'q3-plan.docx', contentType: 'application/msword', disposition: 'attachment' },
		payload
	);
}

describe('parseHeaderPrefix', () => {
	it('returns null while the buffer is shorter than the header', () => {
		const b = frame();
		const headerEnd = parseHeaderPrefix(b)!.headerEnd;
		for (const n of [0, 4, 8, headerEnd - 1]) {
			expect(parseHeaderPrefix(b.subarray(0, n))).toBeNull();
		}
	});

	it('parses as soon as the header is complete, without the payload', () => {
		const b = frame();
		const headerEnd = parseHeaderPrefix(b)!.headerEnd;
		const parsed = parseHeaderPrefix(b.subarray(0, headerEnd));
		expect(parsed).not.toBeNull();
		expect(parsed!.header.filename).toBe('q3-plan.docx');
		expect(parsed!.header.contentType).toBe('application/msword');
		expect(parsed!.header.plaintextSize).toBe(payload.byteLength);
		expect(parsed!.headerEnd).toBe(headerEnd);
	});

	it('rejects a bad magic as soon as it is visible', () => {
		const b = frame();
		b[1] = 0x58;
		expect(() => parseHeaderPrefix(b.subarray(0, 2))).toThrow(/bad magic/);
	});

	it('rejects an unsupported version', () => {
		const b = frame();
		b[4] = 0x02;
		expect(() => parseHeaderPrefix(b)).toThrow(/unsupported version/);
	});

	it('rejects an out-of-range header length', () => {
		const b = frame();
		new DataView(b.buffer, b.byteOffset + 5, 4).setUint32(0, 0, false);
		expect(() => parseHeaderPrefix(b)).toThrow(/bad header length/);
	});

	it('leaves parse() working on a whole frame', () => {
		const { header, payload: got } = parse(frame());
		expect(header.filename).toBe('q3-plan.docx');
		expect([...got]).toEqual([...payload]);
	});
});
