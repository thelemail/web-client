import * as openpgp from 'openpgp';

export const KEY_TRANSITION_TYPE = 'thelemail-key-transition/v1';
export const MAX_TRANSITION_SIGNATURE_BYTES = 1024;

export type KeyTransitionErrorCode =
	| 'malformed'
	| 'signature_type'
	| 'hash'
	| 'previous_key'
	| 'signer'
	| 'signature'
	| 'expired';

export class KeyTransitionError extends Error {
	code: KeyTransitionErrorCode;
	constructor(code: KeyTransitionErrorCode, message?: string) {
		super(message ?? code);
		this.code = code;
		this.name = 'KeyTransitionError';
	}
}

function jsonString(s: string): string {
	return JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function keyTransitionPayload(
	accountId: string,
	newKeyFingerprint: string,
	previousKeyFingerprint: string
): Uint8Array {
	const text =
		`{"accountId":${jsonString(accountId)}` +
		`,"newKeyFingerprint":${jsonString(newKeyFingerprint.toLowerCase())}` +
		`,"previousKeyFingerprint":${jsonString(previousKeyFingerprint.toLowerCase())}` +
		`,"type":${jsonString(KEY_TRANSITION_TYPE)}}`;
	return new TextEncoder().encode(text);
}

const ALLOWED_HASHES = new Set<number>([
	openpgp.enums.hash.sha256,
	openpgp.enums.hash.sha384,
	openpgp.enums.hash.sha512,
	openpgp.enums.hash.sha3_256,
	openpgp.enums.hash.sha3_512
]);

export interface KeyTransitionInput {
	accountId: string;
	newKeyFingerprint: string;
	previousKeyFingerprint: string;
	signature: Uint8Array;
	previousPublicKeyArmored: string;
}

export function fingerprintHexOf(key: openpgp.Key | openpgp.PublicKeyPacket): string {
	const fp = key.getFingerprint();
	if (typeof fp === 'string') return fp.toLowerCase();
	return Array.from(new Uint8Array(fp as ArrayLike<number>), (b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function singlePacketTag(b: Uint8Array): number | null {
	if (b.length < 2 || (b[0] & 0x80) === 0) return null;
	let tag: number;
	let header: number;
	let length: number;
	if ((b[0] & 0x40) !== 0) {
		tag = b[0] & 0x3f;
		const l = b[1];
		if (l < 192) {
			header = 2;
			length = l;
		} else if (l < 224) {
			if (b.length < 3) return null;
			header = 3;
			length = ((l - 192) << 8) + b[2] + 192;
		} else if (l === 255) {
			if (b.length < 6) return null;
			header = 6;
			length = ((b[2] << 24) >>> 0) + (b[3] << 16) + (b[4] << 8) + b[5];
		} else {
			return null;
		}
	} else {
		tag = (b[0] >> 2) & 0x0f;
		switch (b[0] & 0x03) {
			case 0:
				header = 2;
				length = b[1];
				break;
			case 1:
				if (b.length < 3) return null;
				header = 3;
				length = (b[1] << 8) + b[2];
				break;
			case 2:
				if (b.length < 5) return null;
				header = 5;
				length = ((b[1] << 24) >>> 0) + (b[2] << 16) + (b[3] << 8) + b[4];
				break;
			default:
				return null;
		}
	}
	return header + length === b.length ? tag : null;
}

async function readSingleSignature(raw: Uint8Array): Promise<openpgp.SignaturePacket> {
	if (raw.length === 0 || raw.length > MAX_TRANSITION_SIGNATURE_BYTES) {
		throw new KeyTransitionError('malformed', `signature is ${raw.length} bytes`);
	}
	if (singlePacketTag(raw) !== openpgp.enums.packet.signature) {
		throw new KeyTransitionError('malformed', 'not exactly one signature packet');
	}
	let parsed: openpgp.Signature;
	try {
		parsed = await openpgp.readSignature({ binarySignature: raw });
	} catch (e) {
		throw new KeyTransitionError('malformed', e instanceof Error ? e.message : 'unreadable signature');
	}
	const packets = [...parsed.packets];
	if (packets.length !== 1 || !(packets[0] instanceof openpgp.SignaturePacket)) {
		throw new KeyTransitionError('malformed', 'not exactly one signature packet');
	}
	return packets[0];
}

async function readPreviousKey(armored: string): Promise<openpgp.Key> {
	let keys: openpgp.Key[];
	try {
		keys = await openpgp.readKeys({ armoredKeys: armored });
	} catch (e) {
		throw new KeyTransitionError('previous_key', e instanceof Error ? e.message : 'unreadable key');
	}
	if (keys.length !== 1) throw new KeyTransitionError('previous_key', 'expected one key');
	return keys[0];
}

export async function verifyKeyTransition(input: KeyTransitionInput): Promise<void> {
	const previousFingerprint = input.previousKeyFingerprint.toLowerCase();
	const payload = keyTransitionPayload(
		input.accountId,
		input.newKeyFingerprint,
		previousFingerprint
	);
	const sig = await readSingleSignature(input.signature);
	if (sig.signatureType !== openpgp.enums.signature.binary) {
		throw new KeyTransitionError('signature_type', 'endorsement is not a binary document signature');
	}
	if (sig.hashAlgorithm === null || !ALLOWED_HASHES.has(sig.hashAlgorithm)) {
		throw new KeyTransitionError('hash', 'endorsement hash is weaker than SHA-256');
	}
	const previous = await readPreviousKey(input.previousPublicKeyArmored);
	const primary = previous.keyPacket;
	if (fingerprintHexOf(primary) !== previousFingerprint) {
		throw new KeyTransitionError('signer', 'previous key does not have the endorsed fingerprint');
	}
	const hasFingerprint = sig.issuerFingerprint !== null && sig.issuerFingerprint.length > 0;
	const hasKeyId = sig.issuerKeyID.bytes.length > 0;
	if (!hasFingerprint && !hasKeyId) {
		throw new KeyTransitionError('signer', 'endorsement names no issuer');
	}
	if (hasFingerprint && bytesToHex(sig.issuerFingerprint as Uint8Array) !== previousFingerprint) {
		throw new KeyTransitionError('signer', 'endorsement was not made by the previous primary key');
	}
	if (hasKeyId && !sig.issuerKeyID.equals(primary.getKeyID())) {
		throw new KeyTransitionError('signer', 'endorsement was not made by the previous primary key');
	}
	if (sig.version !== primary.version) {
		throw new KeyTransitionError('signature', 'signature version does not match the key');
	}
	const message = await openpgp.createMessage({ binary: payload });
	const literal = message.packets.findPacket(openpgp.enums.packet.literalData);
	if (!literal) throw new KeyTransitionError('malformed', 'payload could not be framed');
	try {
		await sig.verify(primary, openpgp.enums.signature.binary, literal, null as unknown as Date, true);
	} catch (e) {
		throw new KeyTransitionError('signature', e instanceof Error ? e.message : 'signature does not verify');
	}
	const created = sig.created;
	if (!created || created.getTime() < primary.getCreationTime().getTime()) {
		throw new KeyTransitionError('expired', 'endorsement predates the previous key');
	}
	try {
		await previous.verifyPrimaryKey(created);
	} catch (e) {
		throw new KeyTransitionError('expired', e instanceof Error ? e.message : 'previous key was not valid');
	}
}
