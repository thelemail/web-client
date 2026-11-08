import * as openpgp from 'openpgp';
import { bytesEqual, sha256 } from './encoding';
import { transcript } from './envelope';
import { fail } from './errors';
import { PROFILE } from './profiles';

const MAX_PUBLIC_KEY_BYTES = 256 << 10;
const MAX_SIGNATURE_BYTES = 64 << 10;
const ALLOWED_HASHES = new Set<number>([
	openpgp.enums.hash.sha256,
	openpgp.enums.hash.sha384,
	openpgp.enums.hash.sha512,
	openpgp.enums.hash.sha3_256,
	openpgp.enums.hash.sha3_512
]);

export async function parsePublicKey(raw: Uint8Array): Promise<openpgp.PublicKey> {
	if (raw.length === 0 || raw.length > MAX_PUBLIC_KEY_BYTES) fail('profile', 'public key size');
	let key: openpgp.Key;
	try {
		key = await openpgp.readKey({ binaryKey: raw });
	} catch {
		fail('profile', 'not a public key');
	}
	if (key.isPrivate()) fail('profile', 'secret key material');
	if (!bytesEqual(key.write(), raw)) fail('profile', 'noncanonical key encoding');
	return key as openpgp.PublicKey;
}

export function publicKeyBytes(key: openpgp.Key): Uint8Array {
	return key.toPublic().write();
}

export async function publicKeyDigest(key: openpgp.Key): Promise<Uint8Array> {
	return sha256(publicKeyBytes(key));
}

export function fingerprintBytes(key: openpgp.Key): Uint8Array {
	const hex = key.getFingerprint();
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function flags(sig: openpgp.SignaturePacket | undefined): number {
	return sig?.keyFlags?.[0] ?? 0;
}

export async function validateProfile(profileId: string, key: openpgp.Key): Promise<void> {
	const primary = key.keyPacket;
	if (primary.version !== 6 || primary.algorithm !== openpgp.enums.publicKey.ed25519 || key.getUserIDs().length !== 0) {
		fail('profile', 'primary key');
	}
	const f = flags(key.directSignatures[0]);
	const encrypt = openpgp.enums.keyFlags.encryptCommunication | openpgp.enums.keyFlags.encryptStorage;
	if (!(f & openpgp.enums.keyFlags.signData) || f & encrypt) fail('profile', 'primary key flags');
	if (profileId === PROFILE.accountAuthority) {
		if (key.subkeys.length !== 0) fail('profile', 'authority key has subkeys');
		return;
	}
	if (profileId !== PROFILE.calendarIdentity) fail('profile', `unknown profile ${profileId}`);
	if (key.subkeys.length !== 1) fail('profile', 'calendar identity needs one subkey');
	const sub = key.subkeys[0];
	const sf = flags(sub.bindingSignatures[0]);
	if (sub.keyPacket.version !== 6 || sub.keyPacket.algorithm !== openpgp.enums.publicKey.x25519 || !(sf & openpgp.enums.keyFlags.encryptCommunication) || sf & openpgp.enums.keyFlags.signData) {
		fail('profile', 'calendar encryption subkey');
	}
}

export async function signTranscript(domain: string, raw: Uint8Array, key: openpgp.PrivateKey): Promise<Uint8Array> {
	const message = await openpgp.createMessage({ binary: transcript(domain, raw) });
	const sig = await openpgp.sign({ message, signingKeys: key, detached: true, format: 'binary' });
	return sig as Uint8Array;
}

export async function verifyTranscript(domain: string, raw: Uint8Array, signature: Uint8Array, key: openpgp.Key): Promise<void> {
	if (signature.length === 0 || signature.length > MAX_SIGNATURE_BYTES) fail('signature');
	let sig: openpgp.Signature;
	try {
		sig = await openpgp.readSignature({ binarySignature: signature });
	} catch {
		fail('signature');
	}
	const packets = sig.packets;
	if (packets.length !== 1) fail('signature');
	const p = packets[0];
	const primary = key.keyPacket;
	if (
		p.signatureType !== openpgp.enums.signature.binary ||
		!ALLOWED_HASHES.has(p.hashAlgorithm as number) ||
		p.version !== primary.version ||
		!p.issuerFingerprint ||
		!bytesEqual(p.issuerFingerprint, primary.getFingerprintBytes())
	) {
		fail('signature');
	}
	const message = await openpgp.createMessage({ binary: transcript(domain, raw) });
	try {
		const result = await openpgp.verify({ message, signature: sig, verificationKeys: key, expectSigned: true, format: 'binary' });
		await result.signatures[0].verified;
	} catch {
		fail('signature');
	}
}

export async function generateAuthorityKey(): Promise<openpgp.PrivateKey> {
	const { privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [], subkeys: [], format: 'object', config: { v6Keys: true } });
	return privateKey;
}

export async function generateCalendarIdentity(): Promise<openpgp.PrivateKey> {
	const { privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [], format: 'object', config: { v6Keys: true } });
	return privateKey;
}

export function secretKeyBytes(key: openpgp.PrivateKey): Uint8Array {
	if (!key.isDecrypted()) fail('malformed', 'secret key is locked');
	return key.write();
}
