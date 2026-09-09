import { describe, expect, it } from 'vitest';
import { parseNote, parseVerifierKey } from './note';

const LOG_VKEY = 'test.thelemail.com/keys+c4c5905b+ATrXu0X7XNHJ4s3quMMBIa0odVwRYHMRbwNhx010oXKu';
const WITNESS_VKEY = 'witness1.example.org+ca7a5e13+BJmafJkUufEecDFtHm9Xxcow35DcXWWQmCjBkCuAmM+J';

describe('parseVerifierKey', () => {
	it('parses an Ed25519 log key', () => {
		const key = parseVerifierKey(LOG_VKEY);
		expect(key.name).toBe('test.thelemail.com/keys');
		expect(key.algorithm).toBe(0x01);
		expect(key.publicKey).toHaveLength(32);
	});

	it('parses a cosignature key whose base64 contains a plus sign', () => {
		const key = parseVerifierKey(WITNESS_VKEY);
		expect(key.name).toBe('witness1.example.org');
		expect(key.algorithm).toBe(0x04);
		expect(key.publicKey).toHaveLength(32);
	});

	it('rejects a key with too few segments', () => {
		expect(() => parseVerifierKey('name+deadbeef')).toThrow();
		expect(() => parseVerifierKey('nameonly')).toThrow();
	});

	it('rejects an empty name', () => {
		expect(() => parseVerifierKey('+c4c5905b+ATrXu0X7XNHJ4s3quMMBIa0odVwRYHMRbwNhx010oXKu')).toThrow();
	});

	it('rejects a malformed hash segment', () => {
		expect(() =>
			parseVerifierKey('test.thelemail.com/keys+C4C5905B+ATrXu0X7XNHJ4s3quMMBIa0odVwRYHMRbwNhx010oXKu')
		).toThrow();
		expect(() =>
			parseVerifierKey('test.thelemail.com/keys+c4c5+ATrXu0X7XNHJ4s3quMMBIa0odVwRYHMRbwNhx010oXKu')
		).toThrow();
	});

	it('rejects a hash that does not match the key material', () => {
		expect(() =>
			parseVerifierKey('test.thelemail.com/keys+00000000+ATrXu0X7XNHJ4s3quMMBIa0odVwRYHMRbwNhx010oXKu')
		).toThrow();
	});

	it('rejects key material of the wrong length', () => {
		expect(() => parseVerifierKey('test.thelemail.com/keys+c4c5905b+AAAA')).toThrow();
	});
});

describe('parseNote', () => {
	const body = 'origin\n3\nroot\n';
	const sig = '— name c4xZBWFrZmFzZGZhc2RmYXNkZmFzZGY=\n';

	it('splits text and signatures at the last blank line', () => {
		const note = parseNote(body + '\n' + sig);
		expect(note.text).toBe(body);
		expect(note.signatures).toHaveLength(1);
		expect(note.signatures[0].name).toBe('name');
	});

	it('rejects a note without a trailing newline', () => {
		expect(() => parseNote(body + '\n' + sig.trimEnd())).toThrow();
	});

	it('rejects a note without signatures', () => {
		expect(() => parseNote(body)).toThrow();
		expect(() => parseNote(body + '\n')).toThrow();
	});

	it('rejects a malformed signature line', () => {
		expect(() => parseNote(body + '\n' + 'not a signature\n')).toThrow();
		expect(() => parseNote(body + '\n' + '— name not*base64\n')).toThrow();
	});
});
