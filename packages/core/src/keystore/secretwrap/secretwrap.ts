import type { SlotPurpose } from '../../interop/generated/profile-ids';
import { SECRET_WRAP } from '../../interop/generated/profile-ids';
import { decodeCanonical, encodeCanonical } from '../productkeys/canonical';
import { b64encode, bytesEqual, requireUuid } from '../productkeys/encoding';
import { checkCipher, open, randomBytes, seal } from '../productkeys/envelope';
import { fail } from '../productkeys/errors';
import type { Obj } from '../productkeys/fields';
import { bin, exact, id, int, str } from '../productkeys/fields';

export type { SlotPurpose };

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface Slot {
	purpose: SlotPurpose;
	accountId: string;
	amkEpoch: number;
	revision: number;
	slotId: string;
	credentialId: string;
	credentialGeneration: number;
	credentialConfigDigest: Uint8Array;
	createdAuthEpoch: number;
}

export interface Bundle {
	accountId: string;
	amkEpoch: number;
	bundleId: string;
	revision: number;
}

export interface WrapParams {
	salt: Uint8Array;
	nonce: Uint8Array;
}

export function isSlotPurpose(p: unknown): p is SlotPurpose {
	return typeof p === 'string' && (SECRET_WRAP.slotPurposes as readonly string[]).includes(p);
}

export function label(purpose: string): string {
	return SECRET_WRAP.labelPrefix + purpose;
}

function counter(v: number, min: number, name: string): void {
	if (!Number.isSafeInteger(v) || v < min) fail('malformed', `${name} out of range`);
}

function identifier(s: string): void {
	if (requireUuid(s) === NIL_UUID) fail('malformed', 'identifiers');
}

export function validateSlot(s: Slot): void {
	if (!isSlotPurpose(s.purpose)) fail('purpose');
	identifier(s.accountId);
	identifier(s.slotId);
	identifier(s.credentialId);
	if (s.credentialConfigDigest.length !== SECRET_WRAP.digestBytes) fail('malformed', 'credential config digest');
	counter(s.amkEpoch, 0, 'amkEpoch');
	counter(s.credentialGeneration, 0, 'credentialGeneration');
	counter(s.createdAuthEpoch, 0, 'createdAuthEpoch');
	counter(s.revision, 1, 'revision');
}

export function validateBundle(b: Bundle): void {
	identifier(b.accountId);
	identifier(b.bundleId);
	counter(b.amkEpoch, 0, 'amkEpoch');
	counter(b.revision, 1, 'revision');
}

function sameSlot(a: Slot, b: Slot): boolean {
	return (
		a.purpose === b.purpose &&
		a.accountId === b.accountId &&
		a.amkEpoch === b.amkEpoch &&
		a.revision === b.revision &&
		a.slotId === b.slotId &&
		a.credentialId === b.credentialId &&
		a.credentialGeneration === b.credentialGeneration &&
		a.createdAuthEpoch === b.createdAuthEpoch &&
		bytesEqual(a.credentialConfigDigest, b.credentialConfigDigest)
	);
}

function sameBundle(a: Bundle, b: Bundle): boolean {
	return a.accountId === b.accountId && a.amkEpoch === b.amkEpoch && a.bundleId === b.bundleId && a.revision === b.revision;
}

function freshParams(p?: WrapParams): WrapParams {
	return p ?? { salt: randomBytes(SECRET_WRAP.saltBytes), nonce: randomBytes(SECRET_WRAP.nonceBytes) };
}

function cipherFields(p: WrapParams): Obj {
	return { kdf: SECRET_WRAP.kdf, aead: SECRET_WRAP.aead, salt: b64encode(p.salt), nonce: b64encode(p.nonce) };
}

async function sealWrapper(ikm: Uint8Array, purpose: string, w: Obj, p: WrapParams, plaintext: Uint8Array): Promise<Uint8Array> {
	const aad = encodeCanonical(w);
	if (aad.length > SECRET_WRAP.maxBytes) fail('too-large');
	const ct = await seal(ikm, label(purpose), aad, p.salt, p.nonce, plaintext);
	const out = encodeCanonical({ ...w, ciphertext: b64encode(ct) });
	if (out.length > SECRET_WRAP.maxBytes) fail('too-large');
	return out;
}

export async function sealSlot(ikm: Uint8Array, s: Slot, amk: Uint8Array, params?: WrapParams): Promise<Uint8Array> {
	if (ikm.length < SECRET_WRAP.minIkmBytes) fail('malformed', 'input key length');
	if (amk.length !== SECRET_WRAP.amkBytes) fail('malformed', 'amk length');
	validateSlot(s);
	const p = freshParams(params);
	const w: Obj = {
		version: SECRET_WRAP.version,
		purpose: s.purpose,
		accountId: s.accountId,
		amkEpoch: s.amkEpoch,
		revision: s.revision,
		slotId: s.slotId,
		credentialId: s.credentialId,
		credentialGeneration: s.credentialGeneration,
		credentialConfigDigest: b64encode(s.credentialConfigDigest),
		createdAuthEpoch: s.createdAuthEpoch,
		...cipherFields(p)
	};
	return sealWrapper(ikm, s.purpose, w, p, amk);
}

export async function sealBundle(amk: Uint8Array, b: Bundle, plaintext: Uint8Array, params?: WrapParams): Promise<Uint8Array> {
	if (amk.length !== SECRET_WRAP.amkBytes) fail('malformed', 'amk length');
	validateBundle(b);
	if (plaintext.length > SECRET_WRAP.maxBytes) fail('too-large');
	const p = freshParams(params);
	const w: Obj = {
		version: SECRET_WRAP.version,
		purpose: SECRET_WRAP.bundlePurpose,
		accountId: b.accountId,
		amkEpoch: b.amkEpoch,
		bundleId: b.bundleId,
		revision: b.revision,
		...cipherFields(p)
	};
	return sealWrapper(amk, SECRET_WRAP.bundlePurpose, w, p, plaintext);
}

function readPurpose(raw: Uint8Array): { o: Obj; purpose: string } {
	const o = decodeCanonical(raw, SECRET_WRAP.maxBytes) as Obj;
	const v = o.purpose;
	if (v !== undefined && v !== null && typeof v !== 'string') fail('malformed', 'purpose is not a string');
	const purpose = typeof v === 'string' ? v : '';
	if (purpose !== SECRET_WRAP.bundlePurpose && !isSlotPurpose(purpose)) fail('purpose');
	return { o, purpose };
}

export function wrapPurpose(raw: Uint8Array): string {
	return readPurpose(raw).purpose;
}

function checkEnvelope(w: Obj): void {
	if (int(w, 'version') !== SECRET_WRAP.version) fail('malformed', 'version');
	checkCipher(str(w, 'kdf'), str(w, 'aead'), bin(w, 'salt'), bin(w, 'nonce'), bin(w, 'ciphertext'));
}

function parseSlotWrapper(raw: Uint8Array): { w: Obj; slot: Slot } {
	const { o, purpose } = readPurpose(raw);
	if (!isSlotPurpose(purpose)) fail('purpose');
	const w = exact(o, SECRET_WRAP.slotFields);
	checkEnvelope(w);
	const slot: Slot = {
		purpose,
		accountId: id(w, 'accountId'),
		amkEpoch: int(w, 'amkEpoch'),
		revision: int(w, 'revision'),
		slotId: id(w, 'slotId'),
		credentialId: id(w, 'credentialId'),
		credentialGeneration: int(w, 'credentialGeneration'),
		credentialConfigDigest: bin(w, 'credentialConfigDigest'),
		createdAuthEpoch: int(w, 'createdAuthEpoch')
	};
	validateSlot(slot);
	return { w, slot };
}

function parseBundleWrapper(raw: Uint8Array): { w: Obj; bundle: Bundle } {
	const { o, purpose } = readPurpose(raw);
	if (purpose !== SECRET_WRAP.bundlePurpose) fail('purpose');
	const w = exact(o, SECRET_WRAP.bundleFields);
	checkEnvelope(w);
	const bundle: Bundle = { accountId: id(w, 'accountId'), amkEpoch: int(w, 'amkEpoch'), bundleId: id(w, 'bundleId'), revision: int(w, 'revision') };
	validateBundle(bundle);
	return { w, bundle };
}

export function parseSlot(raw: Uint8Array): Slot {
	return parseSlotWrapper(raw).slot;
}

export function parseBundle(raw: Uint8Array): Bundle {
	return parseBundleWrapper(raw).bundle;
}

async function openWrapper(ikm: Uint8Array, purpose: string, w: Obj): Promise<Uint8Array> {
	const { ciphertext: _ct, ...aadFields } = w;
	return open(ikm, label(purpose), encodeCanonical(aadFields), bin(w, 'salt'), bin(w, 'nonce'), bin(w, 'ciphertext'));
}

export async function openSlot(ikm: Uint8Array, raw: Uint8Array, expect: Slot): Promise<Uint8Array> {
	if (ikm.length < SECRET_WRAP.minIkmBytes) fail('malformed', 'input key length');
	const { w, slot } = parseSlotWrapper(raw);
	if (!sameSlot(slot, expect)) fail('context');
	const amk = await openWrapper(ikm, slot.purpose, w);
	if (amk.length !== SECRET_WRAP.amkBytes) {
		amk.fill(0);
		fail('malformed', 'amk length');
	}
	return amk;
}

export async function openBundle(amk: Uint8Array, raw: Uint8Array, expect: Bundle): Promise<Uint8Array> {
	if (amk.length !== SECRET_WRAP.amkBytes) fail('malformed', 'amk length');
	const { w, bundle } = parseBundleWrapper(raw);
	if (!sameBundle(bundle, expect)) fail('context');
	return openWrapper(amk, SECRET_WRAP.bundlePurpose, w);
}
