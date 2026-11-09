import type * as openpgp from 'openpgp';
import { bytesEqual, sha256 } from '../productkeys/encoding';
import { open, randomBytes, seal } from '../productkeys/envelope';
import { fail } from '../productkeys/errors';
import { signTranscript, verifyTranscript } from '../productkeys/pgp';
import type { Context, Envelope, Grant, Plaintext } from './wire';
import {
	encodeContext,
	encodeEnvelope,
	encodeGrant,
	importPoint,
	KDF_INFO,
	parseEnvelope,
	parsePlaintext,
	plaintextFor,
	SIGNATURE_DOMAIN,
	signedBytes
} from './wire';

export type SharedSecret = (senderPublicKey: Uint8Array) => Promise<Uint8Array>;

export async function ecdhSecret(privateKey: CryptoKey, peer: Uint8Array): Promise<Uint8Array> {
	const pub = await importPoint(peer);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256));
}

export async function sealHandoff(grant: Grant, root: Uint8Array, receiverPublicKey: Uint8Array, signer: openpgp.PrivateKey): Promise<Uint8Array> {
	if (root.length !== 32) fail('malformed', 'product root length');
	if (!bytesEqual(await sha256(receiverPublicKey), grant.receiverKeyDigest)) fail('context', 'receiver key');
	const sender = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
	const shared = await ecdhSecret(sender.privateKey, receiverPublicKey);
	try {
		const context: Context = {
			...grant,
			senderPublicKey: new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey)),
			salt: randomBytes(32),
			nonce: randomBytes(12)
		};
		const aad = encodeContext(context);
		const plain = plaintextFor(grant, root);
		const ciphertext = await seal(shared, KDF_INFO, aad, context.salt, context.nonce, plain);
		plain.fill(0);
		const signature = await signTranscript(SIGNATURE_DOMAIN, await signedBytes(context, ciphertext), signer);
		return encodeEnvelope({ context, ciphertext, signature });
	} finally {
		shared.fill(0);
	}
}

export async function verifyHandoff(raw: Uint8Array, authority: openpgp.Key): Promise<Envelope> {
	const e = await parseEnvelope(raw);
	await verifyTranscript(SIGNATURE_DOMAIN, await signedBytes(e.context, e.ciphertext), e.signature, authority);
	return e;
}

function matches(p: Plaintext, g: Grant): boolean {
	return (
		p.accountId === g.accountId &&
		p.product === g.product &&
		p.productKeyEpoch === g.productKeyEpoch &&
		p.authorityEpoch === g.authorityEpoch &&
		p.credentialGeneration === g.credentialGeneration &&
		p.sessionEpoch === g.sessionEpoch &&
		p.manifestId === g.manifestId &&
		p.manifestRevision === g.manifestRevision &&
		bytesEqual(p.manifestHash, g.manifestHash)
	);
}

export async function openHandoff(e: Envelope, secret: SharedSecret): Promise<Plaintext> {
	const shared = await secret(e.context.senderPublicKey);
	try {
		const raw = await open(shared, KDF_INFO, encodeContext(e.context), e.context.salt, e.context.nonce, e.ciphertext);
		const p = parsePlaintext(raw);
		raw.fill(0);
		if (!matches(p, e.context)) {
			p.productRoot.fill(0);
			fail('context', 'plaintext does not repeat its context');
		}
		return p;
	} finally {
		shared.fill(0);
	}
}

export function sameGrant(a: Grant, b: Grant): boolean {
	return bytesEqual(encodeGrant(a), encodeGrant(b));
}
