import type { Json } from '../productkeys/canonical';
import { decodeCanonical, encodeCanonical, MAX_SAFE } from '../productkeys/canonical';
import { requireUuid, sha256 } from '../productkeys/encoding';
import { fail } from '../productkeys/errors';

export const VERSION = 1;
export const CHALLENGE_METHOD = 'S256';
export const KDF_INFO = 'thelemail/product-handoff/v1';
export const SIGNATURE_DOMAIN = 'thelemail/product-handoff-signature/v1';
export const MAX_ENVELOPE_BYTES = 8 << 10;
export const REDEEM_WINDOW_SECONDS = 60;
export const ADOPT_WINDOW_SECONDS = 360;
const MAX_RECORD_BYTES = 16 << 10;
const POINT_LEN = 65;
const HASH_LEN = 32;

type Obj = { [key: string]: Json };

export function b64url(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
	return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromB64url(s: unknown): Uint8Array {
	if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) fail('malformed', 'noncanonical base64url');
	const std = s.replaceAll('-', '+').replaceAll('_', '/');
	let bin: string;
	try {
		bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4));
	} catch {
		fail('malformed', 'noncanonical base64url');
	}
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	if (b64url(out) !== s) fail('malformed', 'noncanonical base64url');
	return out;
}

const NULLABLE = new Set(['expectedAccountId', 'existingSessionId']);

function exact(o: Json, fields: readonly string[]): Obj {
	if (o === null || typeof o !== 'object' || Array.isArray(o)) fail('malformed', 'not an object');
	const keys = Object.keys(o);
	if (keys.length !== fields.length) fail('malformed', 'unexpected fields');
	for (const f of fields) {
		if (!(f in o)) fail('malformed', `missing ${f}`);
		if (o[f] === null && !NULLABLE.has(f)) fail('malformed', `${f} is null`);
	}
	return o;
}

function str(o: Obj, key: string): string {
	const v = o[key];
	if (typeof v !== 'string') fail('malformed', `${key} is not a string`);
	return v;
}

function int(o: Obj, key: string, min = 0): number {
	const v = o[key];
	if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > MAX_SAFE) fail('malformed', `${key} out of range`);
	return v;
}

function bin(o: Obj, key: string, len?: number): Uint8Array {
	const b = fromB64url(o[key]);
	if (len !== undefined && b.length !== len) fail('malformed', `${key} length`);
	return b;
}

function optId(o: Obj, key: string): string | null {
	return o[key] === null ? null : requireUuid(o[key]);
}

function origin(s: string): string {
	let u: URL;
	try {
		u = new URL(s);
	} catch {
		fail('malformed', 'origin');
	}
	if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.origin !== s) fail('malformed', 'origin');
	return s;
}

function target(o: Obj): { clientId: string; product: 'app' | 'calendar'; origin: string; callback: string } {
	const clientId = str(o, 'clientId');
	const product = str(o, 'product');
	if (!clientId || clientId.length > 64 || (product !== 'app' && product !== 'calendar')) fail('malformed', 'client or product');
	const own = origin(str(o, 'origin'));
	const callback = str(o, 'callback');
	if (!callback.startsWith(own + '/') || callback.includes('?') || callback.includes('#')) fail('malformed', 'callback');
	return { clientId, product, origin: own, callback };
}

export async function importPoint(raw: Uint8Array): Promise<CryptoKey> {
	if (raw.length !== POINT_LEN || raw[0] !== 4) fail('point');
	try {
		return await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
	} catch {
		fail('point');
	}
}

export interface Descriptor {
	version: number;
	requestId: string;
	clientId: string;
	product: 'app' | 'calendar';
	origin: string;
	callback: string;
	state: Uint8Array;
	codeChallenge: Uint8Array;
	codeChallengeMethod: string;
	receiverPublicKey: Uint8Array;
	expectedAccountId: string | null;
	existingSessionId: string | null;
	createdAt: number;
	expiresAt: number;
}

const DESCRIPTOR_FIELDS = [
	'callback', 'clientId', 'codeChallenge', 'codeChallengeMethod', 'createdAt', 'existingSessionId',
	'expectedAccountId', 'expiresAt', 'origin', 'product', 'receiverPublicKey', 'requestId', 'state', 'version'
] as const;

export async function parseDescriptor(raw: Uint8Array): Promise<Descriptor> {
	const o = exact(decodeCanonical(raw, MAX_RECORD_BYTES), DESCRIPTOR_FIELDS);
	if (int(o, 'version', 1) !== VERSION || str(o, 'codeChallengeMethod') !== CHALLENGE_METHOD) fail('malformed', 'descriptor version or challenge method');
	const d: Descriptor = {
		version: VERSION,
		requestId: requireUuid(o.requestId),
		...target(o),
		state: bin(o, 'state', 32),
		codeChallenge: bin(o, 'codeChallenge', 32),
		codeChallengeMethod: CHALLENGE_METHOD,
		receiverPublicKey: bin(o, 'receiverPublicKey'),
		expectedAccountId: optId(o, 'expectedAccountId'),
		existingSessionId: optId(o, 'existingSessionId'),
		createdAt: int(o, 'createdAt'),
		expiresAt: int(o, 'expiresAt')
	};
	if (d.expiresAt <= d.createdAt) fail('malformed', 'descriptor expiry');
	await importPoint(d.receiverPublicKey);
	return d;
}

export interface Grant {
	version: number;
	issuer: string;
	requestId: string;
	accountId: string;
	clientId: string;
	product: 'app' | 'calendar';
	origin: string;
	callback: string;
	receiverKeyDigest: Uint8Array;
	stateHash: Uint8Array;
	sourceSessionId: string;
	destinationSessionId: string;
	credentialGeneration: number;
	sessionEpoch: number;
	authorityEpoch: number;
	productKeyEpoch: number;
	manifestId: string;
	manifestRevision: number;
	manifestHash: Uint8Array;
	accountHeadRevision: number;
	accountHeadHash: Uint8Array;
	issuedAt: number;
	redeemBy: number;
	adoptBy: number;
}

const GRANT_FIELDS = [
	'accountHeadHash', 'accountHeadRevision', 'accountId', 'adoptBy', 'authorityEpoch', 'callback', 'clientId',
	'credentialGeneration', 'destinationSessionId', 'issuedAt', 'issuer', 'manifestHash', 'manifestId',
	'manifestRevision', 'origin', 'product', 'productKeyEpoch', 'receiverKeyDigest', 'redeemBy', 'requestId',
	'sessionEpoch', 'sourceSessionId', 'stateHash', 'version'
] as const;
const CONTEXT_FIELDS = [...GRANT_FIELDS, 'nonce', 'salt', 'senderPublicKey'].sort();

function grantFrom(o: Obj): Grant {
	if (int(o, 'version', 1) !== VERSION) fail('malformed', 'grant version');
	const g: Grant = {
		version: VERSION,
		issuer: origin(str(o, 'issuer')),
		requestId: requireUuid(o.requestId),
		accountId: requireUuid(o.accountId),
		...target(o),
		receiverKeyDigest: bin(o, 'receiverKeyDigest', HASH_LEN),
		stateHash: bin(o, 'stateHash', HASH_LEN),
		sourceSessionId: requireUuid(o.sourceSessionId),
		destinationSessionId: requireUuid(o.destinationSessionId),
		credentialGeneration: int(o, 'credentialGeneration'),
		sessionEpoch: int(o, 'sessionEpoch'),
		authorityEpoch: int(o, 'authorityEpoch', 1),
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		manifestId: requireUuid(o.manifestId),
		manifestRevision: int(o, 'manifestRevision', 1),
		manifestHash: bin(o, 'manifestHash', HASH_LEN),
		accountHeadRevision: int(o, 'accountHeadRevision', 1),
		accountHeadHash: bin(o, 'accountHeadHash', HASH_LEN),
		issuedAt: int(o, 'issuedAt'),
		redeemBy: int(o, 'redeemBy'),
		adoptBy: int(o, 'adoptBy')
	};
	if (g.redeemBy !== g.issuedAt + REDEEM_WINDOW_SECONDS || g.adoptBy !== g.issuedAt + ADOPT_WINDOW_SECONDS) fail('malformed', 'grant deadlines');
	return g;
}

function grantJson(g: Grant): Obj {
	return {
		version: VERSION,
		issuer: g.issuer,
		requestId: g.requestId,
		accountId: g.accountId,
		clientId: g.clientId,
		product: g.product,
		origin: g.origin,
		callback: g.callback,
		receiverKeyDigest: b64url(g.receiverKeyDigest),
		stateHash: b64url(g.stateHash),
		sourceSessionId: g.sourceSessionId,
		destinationSessionId: g.destinationSessionId,
		credentialGeneration: g.credentialGeneration,
		sessionEpoch: g.sessionEpoch,
		authorityEpoch: g.authorityEpoch,
		productKeyEpoch: g.productKeyEpoch,
		manifestId: g.manifestId,
		manifestRevision: g.manifestRevision,
		manifestHash: b64url(g.manifestHash),
		accountHeadRevision: g.accountHeadRevision,
		accountHeadHash: b64url(g.accountHeadHash),
		issuedAt: g.issuedAt,
		redeemBy: g.redeemBy,
		adoptBy: g.adoptBy
	};
}

export function parseGrant(raw: Uint8Array): Grant {
	return grantFrom(exact(decodeCanonical(raw, MAX_RECORD_BYTES), GRANT_FIELDS));
}

export function encodeGrant(g: Grant): Uint8Array {
	return encodeCanonical(grantJson(g));
}

export interface Context extends Grant {
	senderPublicKey: Uint8Array;
	salt: Uint8Array;
	nonce: Uint8Array;
}

function contextFrom(o: Obj): Context {
	exact(o, CONTEXT_FIELDS);
	return { ...grantFrom(o), senderPublicKey: bin(o, 'senderPublicKey'), salt: bin(o, 'salt', 32), nonce: bin(o, 'nonce', 12) };
}

function contextJson(c: Context): Obj {
	return { ...grantJson(c), senderPublicKey: b64url(c.senderPublicKey), salt: b64url(c.salt), nonce: b64url(c.nonce) };
}

export function encodeContext(c: Context): Uint8Array {
	return encodeCanonical(contextJson(c));
}

export interface Envelope {
	context: Context;
	ciphertext: Uint8Array;
	signature: Uint8Array;
}

export async function parseEnvelope(raw: Uint8Array): Promise<Envelope> {
	if (raw.length > MAX_ENVELOPE_BYTES) fail('too-large');
	const o = exact(decodeCanonical(raw, MAX_ENVELOPE_BYTES), ['ciphertext', 'context', 'signature', 'version']);
	if (int(o, 'version', 1) !== VERSION) fail('malformed', 'envelope version');
	const context = contextFrom(o.context as Obj);
	await importPoint(context.senderPublicKey);
	const ciphertext = bin(o, 'ciphertext');
	const signature = bin(o, 'signature');
	if (ciphertext.length < 17 || signature.length === 0) fail('malformed', 'ciphertext or signature');
	return { context, ciphertext, signature };
}

export function encodeEnvelope(e: Envelope): Uint8Array {
	const raw = encodeCanonical({ version: VERSION, context: contextJson(e.context), ciphertext: b64url(e.ciphertext), signature: b64url(e.signature) });
	if (raw.length > MAX_ENVELOPE_BYTES) fail('too-large');
	return raw;
}

export async function signedBytes(c: Context, ciphertext: Uint8Array): Promise<Uint8Array> {
	return encodeCanonical({ context: contextJson(c), ciphertextHash: b64url(await sha256(ciphertext)) });
}

export interface Plaintext {
	accountId: string;
	product: 'app' | 'calendar';
	productRoot: Uint8Array;
	productKeyEpoch: number;
	authorityEpoch: number;
	credentialGeneration: number;
	sessionEpoch: number;
	manifestId: string;
	manifestRevision: number;
	manifestHash: Uint8Array;
}

const PLAIN_FIELDS = [
	'accountId', 'authorityEpoch', 'credentialGeneration', 'manifestHash', 'manifestId', 'manifestRevision',
	'product', 'productKeyEpoch', 'productRoot', 'sessionEpoch', 'version'
] as const;

export function plaintextFor(g: Grant, root: Uint8Array): Uint8Array {
	return encodeCanonical({
		version: VERSION,
		accountId: g.accountId,
		product: g.product,
		productRoot: b64url(root),
		productKeyEpoch: g.productKeyEpoch,
		authorityEpoch: g.authorityEpoch,
		credentialGeneration: g.credentialGeneration,
		sessionEpoch: g.sessionEpoch,
		manifestId: g.manifestId,
		manifestRevision: g.manifestRevision,
		manifestHash: b64url(g.manifestHash)
	});
}

export function parsePlaintext(raw: Uint8Array): Plaintext {
	const o = exact(decodeCanonical(raw, MAX_RECORD_BYTES), PLAIN_FIELDS);
	if (int(o, 'version', 1) !== VERSION) fail('malformed', 'plaintext version');
	const product = str(o, 'product');
	if (product !== 'app' && product !== 'calendar') fail('malformed', 'product');
	return {
		accountId: requireUuid(o.accountId),
		product,
		productRoot: bin(o, 'productRoot', 32),
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		authorityEpoch: int(o, 'authorityEpoch', 1),
		credentialGeneration: int(o, 'credentialGeneration'),
		sessionEpoch: int(o, 'sessionEpoch'),
		manifestId: requireUuid(o.manifestId),
		manifestRevision: int(o, 'manifestRevision', 1),
		manifestHash: bin(o, 'manifestHash', HASH_LEN)
	};
}

export async function challengeS256(verifier: string): Promise<Uint8Array> {
	return sha256(new TextEncoder().encode(verifier));
}
