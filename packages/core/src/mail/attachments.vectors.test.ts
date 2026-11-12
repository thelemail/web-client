// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as openpgp from 'openpgp';
import vectors from '../interop/vectors/attachments.json';
import { build, parse, parseHeader } from './attframe';

function bytes(b64: string): Uint8Array {
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const keys = new Map(vectors.keys.map((k) => [k.name, k]));

describe('attachments agree with trust', () => {
	for (const c of vectors.cases) {
		describe(c.name, () => {
			it('parses the frame trust built', () => {
				const { header, payload } = parse(bytes(c.frame));
				expect(header.filename).toBe(c.header.filename);
				expect(header.contentType).toBe(c.header.contentType);
				expect(header.disposition).toBe(c.header.disposition);
				expect(header.contentId).toBe(c.header.contentId ?? null);
				expect(header.plaintextSize).toBe(c.header.plaintextSize);
				expect(payload).toEqual(bytes(c.payload));
				expect(parseHeader(bytes(c.frame)).filename).toBe(c.header.filename);
			});

			it('builds a frame that reads back to the same header and payload', () => {
				const { filename, contentType, disposition, contentId } = c.header;
				const header = contentId ? { filename, contentType, disposition, contentId } : { filename, contentType, disposition };
				const ours = parse(build(header as Parameters<typeof build>[0], bytes(c.payload)));
				const theirs = parse(bytes(c.frame));
				expect(ours.header).toEqual(theirs.header);
				expect(ours.payload).toEqual(theirs.payload);
			});

			it(`decrypts the SEIPD v${c.seipdVersion} message`, async () => {
				const key = await openpgp.readPrivateKey({ armoredKey: keys.get(c.key)!.privateKeyArmored });
				const message = await openpgp.readMessage({ binaryMessage: bytes(c.message) });
				const { data } = await openpgp.decrypt({ message, decryptionKeys: key, format: 'binary' });
				expect(data).toEqual(bytes(c.frame));
			});
		});
	}
});
