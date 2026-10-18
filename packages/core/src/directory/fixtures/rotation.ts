import vectors from './rotation-vectors.json';
import type { StatementErrorKind } from '../statement';
import type { KeyTransitionErrorCode } from '../key-transition';

export interface VectorKey {
	name: string;
	fingerprint: string;
	keyVersion: number;
	publicKeyArmored: string;
}

export interface VectorStatement {
	name: string;
	raw: string;
	signature: string;
	valid: boolean;
	expected?: {
		accountId: string;
		address: string;
		issuedAt: string;
		keyAlgorithm: string;
		keyFingerprint: string;
		keyTransitions?: { previousKeyFingerprint: string; retiredAt: string; signature: string }[];
		signingKeyFingerprint: string;
		version: number;
	};
	error?: StatementErrorKind;
}

export interface VectorTransition {
	name: string;
	accountId: string;
	newKeyFingerprint: string;
	previousKeyFingerprint: string;
	payload: string;
	signature: string;
	previousPublicKeyArmored: string;
	valid: boolean;
	error?: KeyTransitionErrorCode;
}

export interface RotationVectors {
	schema: string;
	directorySigningKey: VectorKey;
	keys: VectorKey[];
	statements: VectorStatement[];
	transitions: VectorTransition[];
}

export const rotationVectors = vectors as RotationVectors;

export function vectorBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export function vectorKey(fingerprint: string): VectorKey {
	const key = rotationVectors.keys.find((k) => k.fingerprint === fingerprint);
	if (!key) throw new Error(`no vector key ${fingerprint}`);
	return key;
}
