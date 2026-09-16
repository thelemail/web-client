import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesEqual, concatBytes, utf8 } from './bytes';
import {
	NOTE_ALG_COSIGNATURE_V1,
	parseVerifierKey,
	type NoteSignature,
	type VerifierKey
} from './note';

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

export function parseWitnessPolicy(vkeys: readonly string[] | null, threshold: number): VerifierKey[] {
	if (!Number.isInteger(threshold) || threshold < 0) {
		throw new Error('witness threshold must be a non-negative integer');
	}
	const keys: VerifierKey[] = [];
	for (const vkey of vkeys ?? []) {
		const key = parseVerifierKey(vkey);
		if (key.algorithm !== NOTE_ALG_COSIGNATURE_V1) {
			throw new Error(`witness key ${key.name} is not a cosignature key`);
		}
		const clash = keys.find((k) => bytesEqual(k.publicKey, key.publicKey));
		if (clash) {
			throw new Error(`witness keys ${clash.name} and ${key.name} share a signing key`);
		}
		keys.push(key);
	}
	if (threshold > keys.length) {
		throw new Error(`witness threshold ${threshold} exceeds ${keys.length} distinct witness keys`);
	}
	return keys;
}
