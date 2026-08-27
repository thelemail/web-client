import { ed25519 } from '@noble/curves/ed25519.js';
import { concatBytes, utf8 } from './bytes';
import { NOTE_ALG_COSIGNATURE_V1, type NoteSignature, type VerifierKey } from './note';

export function verifyCosignature(
	sig: NoteSignature,
	key: VerifierKey,
	noteText: string
): number | null {
	if (key.algorithm !== NOTE_ALG_COSIGNATURE_V1) return null;
	if (sig.body.length !== 72) return null;
	let timestamp = 0n;
	for (let i = 0; i < 8; i++) timestamp = (timestamp << 8n) | BigInt(sig.body[i]);
	if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) return null;
	const message = concatBytes(utf8(`cosignature/v1\ntime ${timestamp}\n`), utf8(noteText));
	try {
		if (!ed25519.verify(sig.body.slice(8), message, key.publicKey)) return null;
	} catch {
		return null;
	}
	return Number(timestamp);
}
