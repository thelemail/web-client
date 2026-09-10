import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesEqual, bytesFromBase64, bytesToHex, concatBytes, utf8 } from './bytes';

export const NOTE_ALG_ED25519 = 0x01;
export const NOTE_ALG_COSIGNATURE_V1 = 0x04;

export interface NoteSignature {
	name: string;
	keyHash: Uint8Array;
	body: Uint8Array;
}

export interface ParsedNote {
	text: string;
	signatures: NoteSignature[];
}

const SIG_LINE_RE = /^— ([^\s+]+) ([A-Za-z0-9+/]+={0,2})$/;

export function parseNote(raw: string): ParsedNote {
	if (!raw.endsWith('\n')) throw new Error('note must end with newline');
	const split = raw.lastIndexOf('\n\n');
	if (split < 0) throw new Error('note missing signature separator');
	const text = raw.slice(0, split + 1);
	const sigSection = raw.slice(split + 2);
	if (text.length === 0) throw new Error('note text empty');
	const sigLines = sigSection.split('\n');
	if (sigLines.pop() !== '') throw new Error('signature section must end with newline');
	if (sigLines.length === 0) throw new Error('note has no signatures');
	const signatures: NoteSignature[] = [];
	for (const line of sigLines) {
		const m = SIG_LINE_RE.exec(line);
		if (!m) throw new Error('malformed signature line');
		const blob = bytesFromBase64(m[2]);
		if (blob.length < 5) throw new Error('signature too short');
		signatures.push({ name: m[1], keyHash: blob.slice(0, 4), body: blob.slice(4) });
	}
	return { text, signatures };
}

export interface VerifierKey {
	name: string;
	keyHash: Uint8Array;
	algorithm: number;
	publicKey: Uint8Array;
}

export function parseVerifierKey(vkey: string): VerifierKey {
	const first = vkey.indexOf('+');
	const second = first < 0 ? -1 : vkey.indexOf('+', first + 1);
	if (first <= 0 || second < 0) throw new Error('malformed verifier key');
	const name = vkey.slice(0, first);
	const hashHex = vkey.slice(first + 1, second);
	const keyB64 = vkey.slice(second + 1);
	if (/\s/.test(name)) throw new Error('invalid verifier name');
	if (!/^[0-9a-f]{8}$/.test(hashHex)) throw new Error('invalid verifier key hash');
	const keyBytes = bytesFromBase64(keyB64);
	if (keyBytes.length !== 33) throw new Error('invalid verifier key length');
	const computed = sha256(concatBytes(utf8(name), new Uint8Array([0x0a]), keyBytes)).slice(0, 4);
	if (bytesToHex(computed) !== hashHex) throw new Error('verifier key hash mismatch');
	return { name, keyHash: computed, algorithm: keyBytes[0], publicKey: keyBytes.slice(1) };
}

export function findSignature(note: ParsedNote, key: VerifierKey): NoteSignature | null {
	for (const sig of note.signatures) {
		if (sig.name === key.name && bytesEqual(sig.keyHash, key.keyHash)) return sig;
	}
	return null;
}

export function verifyNoteSignature(sig: NoteSignature, key: VerifierKey, text: string): boolean {
	if (key.algorithm !== NOTE_ALG_ED25519) return false;
	if (sig.body.length !== 64) return false;
	try {
		return ed25519.verify(sig.body, utf8(text), key.publicKey);
	} catch {
		return false;
	}
}
