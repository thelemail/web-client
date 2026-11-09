// @vitest-environment node
import { describe, expect, it } from 'vitest';
import raw from './fixtures/product-handoff-v1-vectors.json?raw';
import * as openpgp from 'openpgp';
import { utf8 } from '../productkeys/canonical';
import { bytesEqual, sha256 } from '../productkeys/encoding';
import { ProductKeysError } from '../productkeys/errors';
import { parsePublicKey } from '../productkeys/pgp';
import { ecdhSecret, openHandoff, sameGrant, sealHandoff, verifyHandoff } from './envelope';
import {
	b64url,
	challengeS256,
	encodeContext,
	encodeGrant,
	fromB64url,
	KDF_INFO,
	parseDescriptor,
	parseEnvelope,
	parseGrant,
	plaintextFor,
	signedBytes,
	SIGNATURE_DOMAIN,
	VERSION
} from './wire';

const DIGEST = '24f3671ab8250db85cc82f8b79d26b97f6a37051064de405e7cd8bd1e4f0e110';

interface EnvelopeVector {
	name: string;
	grant: string;
	receiverPrivateKey: string;
	receiverPublicKey: string;
	authorityPublicKey: string;
	envelope: string;
	envelopeDigest: string;
	aad: string;
	signedBytes: string;
	plaintext: string;
	productRoot: string;
	error: string;
}

interface Vectors {
	version: number;
	kdfInfo: string;
	signatureDomain: string;
	descriptors: { name: string; descriptor: string; digest: string; error: string }[];
	pkce: { verifier: string; challenge: string }[];
	envelopes: EnvelopeVector[];
}

const vectors = JSON.parse(raw) as Vectors;

async function code(p: Promise<unknown>): Promise<string> {
	try {
		await p;
		return '';
	} catch (err) {
		if (err instanceof ProductKeysError) return err.code;
		throw err;
	}
}

async function receiverKey(v: EnvelopeVector): Promise<CryptoKey> {
	const pub = fromB64url(v.receiverPublicKey);
	return crypto.subtle.importKey(
		'jwk',
		{ kty: 'EC', crv: 'P-256', d: v.receiverPrivateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) },
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		['deriveBits']
	);
}

async function openAsDestination(v: EnvelopeVector) {
	const grant = parseGrant(utf8(v.grant));
	const authority = await parsePublicKey(fromB64url(v.authorityPublicKey));
	const e = await verifyHandoff(utf8(v.envelope), authority);
	if (!sameGrant(grant, e.context)) throw new ProductKeysError('context');
	if (!bytesEqual(await sha256(fromB64url(v.receiverPublicKey)), e.context.receiverKeyDigest)) throw new ProductKeysError('context');
	const key = await receiverKey(v);
	return openHandoff(e, (peer) => ecdhSecret(key, peer));
}

describe('product handoff vectors', () => {
	it('pins the fixture shared with platform', async () => {
		const sum = Array.from(await sha256(utf8(raw)), (b) => b.toString(16).padStart(2, '0')).join('');
		expect(sum).toBe(DIGEST);
		expect(vectors.version).toBe(VERSION);
		expect(vectors.kdfInfo).toBe(KDF_INFO);
		expect(vectors.signatureDomain).toBe(SIGNATURE_DOMAIN);
	});

	it('parses descriptors and rejects downgrades and bad points', async () => {
		for (const d of vectors.descriptors) {
			expect(await code(parseDescriptor(utf8(d.descriptor))), d.name).toBe(d.error);
			if (!d.error) expect(b64url(await sha256(utf8(d.descriptor)))).toBe(d.digest);
		}
	});

	it('derives the S256 challenge', async () => {
		for (const p of vectors.pkce) expect(b64url(await challengeS256(p.verifier))).toBe(p.challenge);
	});

	it('opens or refuses every envelope exactly as platform does', async () => {
		for (const v of vectors.envelopes) {
			expect(await code(openAsDestination(v)), v.name).toBe(v.error);
		}
	});

	it('reproduces the byte layout of the valid envelope', async () => {
		const v = vectors.envelopes.find((x) => x.name === 'valid')!;
		const e = await parseEnvelope(utf8(v.envelope));
		expect(new TextDecoder().decode(encodeContext(e.context))).toBe(v.aad);
		expect(new TextDecoder().decode(await signedBytes(e.context, e.ciphertext))).toBe(v.signedBytes);
		const grant = parseGrant(utf8(v.grant));
		expect(new TextDecoder().decode(encodeGrant(grant))).toBe(v.grant);
		expect(new TextDecoder().decode(plaintextFor(grant, fromB64url(v.productRoot)))).toBe(v.plaintext);
		const opened = await openAsDestination(v);
		expect(b64url(opened.productRoot)).toBe(v.productRoot);
		expect(b64url(await sha256(utf8(v.envelope)))).toBe(v.envelopeDigest);
	});

	it('round-trips a sealed envelope through a fresh receiver', async () => {
		const v = vectors.envelopes.find((x) => x.name === 'valid')!;
		const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
		const pub = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
		const grant = { ...parseGrant(utf8(v.grant)), receiverKeyDigest: await sha256(pub) };
		const { privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [], subkeys: [], format: 'object', config: { v6Keys: true } });
		const root = crypto.getRandomValues(new Uint8Array(32));
		const raw = await sealHandoff(grant, root, pub, privateKey);
		const e = await verifyHandoff(raw, privateKey.toPublic());
		const opened = await openHandoff(e, (peer) => ecdhSecret(receiver.privateKey, peer));
		expect(bytesEqual(opened.productRoot, root)).toBe(true);
		const stranger = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
		expect(await code(openHandoff(e, (peer) => ecdhSecret(stranger.privateKey, peer)))).toBe('decrypt');
		expect(await code(sealHandoff(grant, root, new Uint8Array(pub).fill(1, 1), privateKey))).toBe('context');
	});
});
