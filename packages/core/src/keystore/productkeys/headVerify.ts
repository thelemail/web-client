import type * as openpgp from 'openpgp';
import { bytesEqual, keyId } from './encoding';
import { fail } from './errors';
import { HEAD_DOMAIN, headHash, parseHeadV2, type HeadSignatures, type HeadV2 } from './head';
import { fingerprintBytes, publicKeyDigest, validateProfile, verifyTranscript } from './pgp';

export async function checkAuthorityKey(h: HeadV2, authority: openpgp.Key): Promise<void> {
	await validateProfile(h.authorityProfileId, authority);
	if (keyId(h.accountId, fingerprintBytes(authority)) !== h.authorityKeyId || !bytesEqual(await publicKeyDigest(authority), h.authorityPublicKeyDigest)) {
		fail('transition', 'authority key does not match the head');
	}
}

function sameHash(a: Uint8Array | null, b: Uint8Array | null): boolean {
	return a === null ? b === null : b !== null && bytesEqual(a, b);
}

export async function verifyBootstrap(
	raw: Uint8Array,
	previousHeadHash: Uint8Array | null,
	sigs: HeadSignatures,
	authority: openpgp.Key,
	legacy: openpgp.Key
): Promise<HeadV2> {
	const h = parseHeadV2(raw);
	if (!sameHash(h.previousHeadHash, previousHeadHash)) fail('transition', 'previous head');
	if (sigs.transition || !sigs.legacy || !sigs.authority) fail('transition', 'bootstrap needs the legacy and authority signatures');
	await checkAuthorityKey(h, authority);
	if (keyId(h.accountId, fingerprintBytes(legacy)) !== h.currentSigningKeyId) fail('transition', 'legacy signer is not the current signing key');
	await verifyTranscript(HEAD_DOMAIN, raw, sigs.legacy, legacy);
	await verifyTranscript(HEAD_DOMAIN, raw, sigs.authority, authority);
	return h;
}

export async function verifySuccessor(
	previousRaw: Uint8Array,
	raw: Uint8Array,
	sigs: HeadSignatures,
	authority: openpgp.Key,
	previousAuthority: openpgp.Key,
	minimumAuthorityEpoch: number
): Promise<HeadV2> {
	const prev = parseHeadV2(previousRaw);
	const h = parseHeadV2(raw);
	if (sigs.legacy) fail('transition', 'a mail key cannot authorize an account head');
	if (h.accountId !== prev.accountId || h.stateRevision !== prev.stateRevision + 1 || !sameHash(h.previousHeadHash, await headHash(previousRaw))) {
		fail('transition', 'head does not continue its predecessor');
	}
	if (h.authorityEpoch < minimumAuthorityEpoch || h.authorityEpoch < prev.authorityEpoch) fail('transition', 'authority epoch below the floor');
	await checkAuthorityKey(prev, previousAuthority);
	await checkAuthorityKey(h, authority);
	if (h.authorityKeyId === prev.authorityKeyId) {
		if (h.authorityEpoch !== prev.authorityEpoch || sigs.transition) fail('transition', 'unchanged authority with a new epoch');
	} else {
		if (h.authorityEpoch <= prev.authorityEpoch || !sigs.transition) fail('transition', 'authority rotation needs a new epoch and the previous authority');
		await verifyTranscript(HEAD_DOMAIN, raw, sigs.transition, previousAuthority);
	}
	if (!sigs.authority) fail('transition', 'authority signature missing');
	await verifyTranscript(HEAD_DOMAIN, raw, sigs.authority, authority);
	return h;
}
