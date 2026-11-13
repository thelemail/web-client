import { encodeCanonical, MAX_SAFE, utf8 } from '../productkeys/canonical';
import { concat, requireUuid } from '../productkeys/encoding';
import { NONCE_LEN, open, randomBytes, SALT_LEN, seal, SECRET_LEN } from '../productkeys/envelope';
import { fail } from '../productkeys/errors';

export const ARTIFACT_KINDS = ['document', 'vectors'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_SOURCES = ['message', 'draft', 'scheduled'] as const;
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];

export const MIN_ARTIFACT_BYTES = 4 << 10;
export const MAX_ARTIFACT_BYTES = 16 << 20;

const TYPE = 'thelemail-search-artifact/v1';
const INFO = 'thelemail/search-artifact/v1';
const MAGIC = utf8('TSA1');
const HEADER = MAGIC.length + SALT_LEN + NONCE_LEN;
const TAG = 16;
const LENGTH = 4;
export const ARTIFACT_OVERHEAD = HEADER + TAG + LENGTH;
const SOURCE_ID_RE = /^[\x21-\x7e]{1,128}$/;

export interface ArtifactContext {
	accountId: string;
	generationId: string;
	kind: ArtifactKind;
	sourceKind: ArtifactSource;
	sourceId: string;
	contentRevision: number;
	componentEpoch: number;
	extractionRevision: number;
}

function counter(n: number, name: string): number {
	if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > MAX_SAFE) fail('malformed', name);
	return n;
}

function aad(c: ArtifactContext, size: number): Uint8Array {
	requireUuid(c.accountId);
	requireUuid(c.generationId);
	if (!(ARTIFACT_KINDS as readonly string[]).includes(c.kind)) fail('malformed', 'artifact kind');
	if (!(ARTIFACT_SOURCES as readonly string[]).includes(c.sourceKind)) fail('malformed', 'source kind');
	if (typeof c.sourceId !== 'string' || !SOURCE_ID_RE.test(c.sourceId)) fail('malformed', 'source id');
	return encodeCanonical({
		type: TYPE,
		accountId: c.accountId,
		generationId: c.generationId,
		kind: c.kind,
		sourceKind: c.sourceKind,
		sourceId: c.sourceId,
		contentRevision: counter(c.contentRevision, 'contentRevision'),
		componentEpoch: counter(c.componentEpoch, 'componentEpoch'),
		extractionRevision: counter(c.extractionRevision, 'extractionRevision'),
		size
	});
}

export function artifactSize(payloadLength: number): number {
	if (!Number.isSafeInteger(payloadLength) || payloadLength < 0 || payloadLength > MAX_ARTIFACT_BYTES - ARTIFACT_OVERHEAD) fail('too-large');
	let size = MIN_ARTIFACT_BYTES;
	while (size < payloadLength + ARTIFACT_OVERHEAD) size *= 2;
	return size;
}

function checkSize(n: number): void {
	if (n < MIN_ARTIFACT_BYTES || n > MAX_ARTIFACT_BYTES || (n & (n - 1)) !== 0) fail('malformed', 'artifact size');
}

export async function sealArtifact(root: Uint8Array, c: ArtifactContext, payload: Uint8Array): Promise<Uint8Array> {
	if (root.length !== SECRET_LEN) fail('malformed', 'search root length');
	const size = artifactSize(payload.length);
	const bound = aad(c, size);
	const salt = randomBytes(SALT_LEN);
	const nonce = randomBytes(NONCE_LEN);
	const plain = new Uint8Array(size - HEADER - TAG);
	new DataView(plain.buffer).setUint32(0, payload.length);
	plain.set(payload, LENGTH);
	let out: Uint8Array;
	try {
		out = concat(MAGIC, salt, nonce, await seal(root, INFO, bound, salt, nonce, plain));
	} finally {
		plain.fill(0);
	}
	checkSize(out.length);
	if (out.length !== size) fail('malformed', 'artifact size');
	return out;
}

export async function openArtifact(root: Uint8Array, c: ArtifactContext, raw: Uint8Array): Promise<Uint8Array> {
	if (root.length !== SECRET_LEN) fail('malformed', 'search root length');
	checkSize(raw.length);
	for (let i = 0; i < MAGIC.length; i++) if (raw[i] !== MAGIC[i]) fail('malformed', 'artifact magic');
	const bound = aad(c, raw.length);
	const salt = raw.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
	const nonce = raw.subarray(MAGIC.length + SALT_LEN, HEADER);
	const plain = await open(root, INFO, bound, salt, nonce, raw.subarray(HEADER));
	const n = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(0);
	if (n > plain.length - LENGTH) fail('malformed', 'artifact length');
	if (artifactSize(n) !== raw.length) fail('malformed', 'artifact bucket');
	for (let i = LENGTH + n; i < plain.length; i++) if (plain[i] !== 0) fail('malformed', 'artifact padding');
	return plain.slice(LENGTH, LENGTH + n);
}
