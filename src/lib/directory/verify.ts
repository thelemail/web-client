import * as openpgp from 'openpgp';
import { hexToBytes } from '$lib/crypto';
import {
	DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX,
	DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED
} from './signing-key';
import { getSeen, upsertSeen } from './seen-idb';
import { DirectoryVerificationError } from './errors';
import { TLOG_POLICY } from './tlog/policy';
import { tlogStateStore } from './tlog/state-idb';
import { verifyTlogProof } from './tlog/verify-tlog';

export { DirectoryVerificationError } from './errors';
export type { DirectoryVerificationCode, DirectoryVerificationDetails } from './errors';

export interface DirectoryStatement {
	address: string;
	accountId: string;
	keyFingerprint: string;
	keyAlgorithm: string;
	version: number;
	issuedAt: string;
	signingKeyFingerprint: string;
}

export interface LookupInputForVerification {
	publicKeyArmored: string;
	directoryStatement: DirectoryStatement;
	directorySignature: string;
	tlogProof?: string;
}

let cachedSigningKey: openpgp.PublicKey | null = null;

async function loadSigningKey(): Promise<openpgp.PublicKey> {
	if (cachedSigningKey) return cachedSigningKey;
	cachedSigningKey = (await openpgp.readKey({
		armoredKey: DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED
	})) as openpgp.PublicKey;
	return cachedSigningKey;
}

function canonicalise(s: DirectoryStatement): Uint8Array {
	const obj = {
		accountId: s.accountId,
		address: s.address,
		issuedAt: s.issuedAt,
		keyAlgorithm: s.keyAlgorithm,
		keyFingerprint: s.keyFingerprint.toLowerCase(),
		signingKeyFingerprint: s.signingKeyFingerprint.toLowerCase(),
		version: s.version
	};
	return new TextEncoder().encode(JSON.stringify(obj));
}

function base64ToBytes(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

async function fingerprintOf(armoredPublicKey: string): Promise<string> {
	const k = await openpgp.readKey({ armoredKey: armoredPublicKey });
	const fp = k.getFingerprint();
	if (typeof fp === 'string') return fp.toLowerCase();
	const bytes = new Uint8Array(fp as ArrayLike<number>);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VerifyOptions {
	acceptKeyChange?: boolean;
}

export async function verifyDirectoryLookup(
	lookup: LookupInputForVerification,
	requestedAddressNormalised: string,
	opts: VerifyOptions = {}
): Promise<{ statement: DirectoryStatement; verifiedAt: Date; firstContact: boolean }> {
	const { directoryStatement: stmt, directorySignature, publicKeyArmored } = lookup;

	if (
		!stmt ||
		typeof stmt.address !== 'string' ||
		typeof stmt.keyFingerprint !== 'string' ||
		typeof stmt.version !== 'number'
	) {
		throw new DirectoryVerificationError(
			'statement_malformed',
			'directoryStatement missing fields',
			{ requestedAddress: requestedAddressNormalised }
		);
	}
	if (
		stmt.signingKeyFingerprint.toLowerCase() !==
		DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase()
	) {
		throw new DirectoryVerificationError(
			'signing_key_mismatch',
			`statement signed by ${stmt.signingKeyFingerprint} but pinned key is ${DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX}`,
			{
				requestedAddress: requestedAddressNormalised,
				expectedSignerFingerprint: DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase(),
				actualSignerFingerprint: stmt.signingKeyFingerprint.toLowerCase()
			}
		);
	}
	if (stmt.keyAlgorithm !== 'openpgp-curve25519-v6') {
		throw new DirectoryVerificationError(
			'algorithm_mismatch',
			`unsupported algorithm ${stmt.keyAlgorithm}`,
			{ requestedAddress: requestedAddressNormalised, keyAlgorithm: stmt.keyAlgorithm }
		);
	}
	if (stmt.address.toLowerCase() !== requestedAddressNormalised.toLowerCase()) {
		throw new DirectoryVerificationError(
			'address_mismatch',
			`statement address ${stmt.address} != requested ${requestedAddressNormalised}`,
			{
				requestedAddress: requestedAddressNormalised,
				statementAddress: stmt.address.toLowerCase()
			}
		);
	}

	const keyFp = await fingerprintOf(publicKeyArmored);
	if (keyFp !== stmt.keyFingerprint.toLowerCase()) {
		throw new DirectoryVerificationError(
			'fingerprint_mismatch',
			`served key fp ${keyFp} != statement fp ${stmt.keyFingerprint}`,
			{
				requestedAddress: requestedAddressNormalised,
				signedKeyFingerprint: stmt.keyFingerprint.toLowerCase(),
				servedKeyFingerprint: keyFp
			}
		);
	}

	const canon = canonicalise(stmt);
	const signatureBytes = base64ToBytes(directorySignature);
	let signature;
	try {
		signature = await openpgp.readSignature({ binarySignature: signatureBytes });
	} catch (e) {
		throw new DirectoryVerificationError(
			'signature_invalid',
			e instanceof Error ? e.message : 'cannot parse signature',
			{
				requestedAddress: requestedAddressNormalised,
				expectedSignerFingerprint: DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase()
			}
		);
	}

	const pinned = await loadSigningKey();
	let verifyResult;
	try {
		verifyResult = await openpgp.verify({
			message: await openpgp.createMessage({ binary: canon }),
			signature,
			verificationKeys: pinned
		});
	} catch (e) {
		throw new DirectoryVerificationError(
			'signature_invalid',
			e instanceof Error ? e.message : 'verify threw',
			{
				requestedAddress: requestedAddressNormalised,
				expectedSignerFingerprint: DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase()
			}
		);
	}
	let ok = false;
	for (const sig of verifyResult.signatures) {
		try {
			await sig.verified;
			ok = true;
			break;
		} catch {
		}
	}
	if (!ok) {
		throw new DirectoryVerificationError(
			'signature_invalid',
			'no valid signature on statement',
			{
				requestedAddress: requestedAddressNormalised,
				expectedSignerFingerprint: DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase()
			}
		);
	}

	if (TLOG_POLICY) {
		try {
			await verifyTlogProof(
				lookup.tlogProof,
				canon,
				requestedAddressNormalised.toLowerCase(),
				TLOG_POLICY,
				{ nowMillis: Date.now(), store: tlogStateStore }
			);
		} catch (e) {
			if (TLOG_POLICY.mode === 'enforce') throw e;
			if (e instanceof DirectoryVerificationError) {
				console.warn('tlog verification failed', e.code, e.message, e.details);
			} else {
				console.warn('tlog verification failed', e);
			}
		}
	}

	const seen = await getSeen(stmt.address.toLowerCase());
	if (seen && stmt.version < seen.version) {
		throw new DirectoryVerificationError(
			'version_rolled_back',
			`statement version ${stmt.version} < last seen ${seen.version}`,
			{
				requestedAddress: requestedAddressNormalised,
				previousVersion: seen.version,
				currentVersion: stmt.version
			}
		);
	}
	if (
		seen &&
		seen.keyFingerprint.toLowerCase() !== stmt.keyFingerprint.toLowerCase() &&
		!opts.acceptKeyChange
	) {
		throw new DirectoryVerificationError(
			'fingerprint_changed',
			`statement key fp ${stmt.keyFingerprint} != last pinned ${seen.keyFingerprint}`,
			{
				requestedAddress: requestedAddressNormalised,
				previousFingerprint: seen.keyFingerprint.toLowerCase(),
				currentFingerprint: stmt.keyFingerprint.toLowerCase(),
				previousVersion: seen.version,
				currentVersion: stmt.version,
				previousVerifiedAtMillis: seen.lastSeenAt
			}
		);
	}

	const now = Date.now();
	await upsertSeen({
		address: stmt.address.toLowerCase(),
		version: Math.max(stmt.version, seen?.version ?? 0),
		keyFingerprint: stmt.keyFingerprint.toLowerCase(),
		firstSeenAt: seen?.firstSeenAt ?? now,
		lastSeenAt: now
	});

	void hexToBytes;

	return { statement: stmt, verifiedAt: new Date(now), firstContact: seen == null };
}
