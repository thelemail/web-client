import * as openpgp from 'openpgp';
import {
	DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX,
	DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED
} from './signing-key';
import { getSeen, upsertSeen } from './seen-idb';
import { keyLabel, labelMatchesKey } from './keyLabel';
import {
	DirectoryVerificationError,
	type DirectoryVerificationCode,
	type DirectoryVerificationDetails,
	type TlogOutcome
} from './errors';
import {
	decodeStrictBase64,
	parseStatementBytes,
	StatementParseError,
	type DirectoryStatement,
	type StatementKeyTransition
} from './statement';
import { fingerprintHexOf, KeyTransitionError, verifyKeyTransition } from './key-transition';
import { TLOG_POLICY } from './tlog/policy';
import { tlogStateStore } from './tlog/state-idb';
import { lookupAccount } from '$core/api/accounts';
import { verifyTlogProof, type TlogConsistencyProof } from './tlog/verify-tlog';

export { DirectoryVerificationError } from './errors';
export type { DirectoryVerificationCode, DirectoryVerificationDetails, TlogOutcome } from './errors';
export type { DirectoryStatement, StatementKeyTransition } from './statement';

export interface PreviousKeyInput {
	fingerprint: string;
	publicKeyArmored: string;
}

export interface LookupInputForVerification {
	publicKeyArmored: string;
	directoryStatementRaw?: string;
	directorySignature: string;
	tlogProof?: string;
	tlogConsistency?: TlogConsistencyProof;
	previousKey?: PreviousKeyInput;
}

let cachedSigningKey: openpgp.PublicKey | null = null;

async function loadSigningKey(): Promise<openpgp.PublicKey> {
	if (cachedSigningKey) return cachedSigningKey;
	cachedSigningKey = (await openpgp.readKey({
		armoredKey: DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED
	})) as openpgp.PublicKey;
	return cachedSigningKey;
}


export interface KeyTransitionResult {
	previousFingerprint: string;
	retiredAt: string;
	retiredAtMillis: number;
}

export interface DirectoryVerificationResult {
	statement: DirectoryStatement;
	publicKeyArmored: string;
	verifiedAt: Date;
	firstContact: boolean;
	tlog: TlogOutcome;
	transition?: KeyTransitionResult;
}

export interface VerifyOptions {
	acceptFingerprint?: string;
	pin?: boolean;
}

function parseRaw(raw: string | undefined, requestedAddress: string): {
	bytes: Uint8Array;
	statement: DirectoryStatement;
} {
	const bytes = raw ? decodeStrictBase64(raw) : null;
	if (!bytes) {
		throw new DirectoryVerificationError('statement_malformed', 'lookup carries no statement bytes', {
			requestedAddress,
			statementError: 'missing'
		});
	}
	try {
		return { bytes, statement: parseStatementBytes(bytes) };
	} catch (e) {
		if (e instanceof StatementParseError) {
			throw new DirectoryVerificationError('statement_malformed', e.message, {
				requestedAddress,
				statementError: e.kind,
				statementField: e.field
			});
		}
		throw e;
	}
}

async function verifyDirectorySignature(
	raw: Uint8Array,
	signatureB64: string,
	requestedAddress: string
): Promise<void> {
	const details = {
		requestedAddress,
		expectedSignerFingerprint: DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase()
	};
	const signatureBytes = decodeStrictBase64(signatureB64);
	if (!signatureBytes) {
		throw new DirectoryVerificationError('signature_invalid', 'directory signature is not base64', details);
	}
	let signature;
	try {
		signature = await openpgp.readSignature({ binarySignature: signatureBytes });
	} catch (e) {
		throw new DirectoryVerificationError(
			'signature_invalid',
			e instanceof Error ? e.message : 'cannot parse signature',
			details
		);
	}
	let verifyResult;
	try {
		verifyResult = await openpgp.verify({
			message: await openpgp.createMessage({ binary: raw }),
			signature,
			verificationKeys: await loadSigningKey()
		});
	} catch (e) {
		throw new DirectoryVerificationError(
			'signature_invalid',
			e instanceof Error ? e.message : 'verify threw',
			details
		);
	}
	for (const sig of verifyResult.signatures) {
		try {
			await sig.verified;
			return;
		} catch {
			continue;
		}
	}
	throw new DirectoryVerificationError('signature_invalid', 'no valid signature on statement', details);
}

async function readServedKey(
	armored: string,
	stmt: DirectoryStatement,
	requestedAddress: string
): Promise<openpgp.Key> {
	try {
		return await openpgp.readKey({ armoredKey: armored });
	} catch (e) {
		throw new DirectoryVerificationError(
			'fingerprint_mismatch',
			e instanceof Error ? e.message : 'served key is unreadable',
			{ requestedAddress, signedKeyFingerprint: stmt.keyFingerprint }
		);
	}
}

async function checkTlog(
	lookup: LookupInputForVerification,
	raw: Uint8Array,
	requestedAddress: string
): Promise<{ outcome: TlogOutcome; enforced: DirectoryVerificationError | null }> {
	if (!TLOG_POLICY) return { outcome: { state: 'not_configured' }, enforced: null };
	const policy = TLOG_POLICY;
	try {
		const details = await verifyTlogProof(lookup.tlogProof, raw, requestedAddress.toLowerCase(), policy, {
			nowMillis: Date.now(),
			store: tlogStateStore,
			consistency: lookup.tlogConsistency,
			refetchConsistency: async (since) =>
				(await lookupAccount(requestedAddress, since)).tlogConsistency
		});
		return { outcome: { state: 'verified', ...details }, enforced: null };
	} catch (e) {
		const err =
			e instanceof DirectoryVerificationError
				? e
				: new DirectoryVerificationError(
						'tlog_proof_malformed',
						e instanceof Error ? e.message : 'tlog check failed',
						{ logOrigin: policy.origin }
					);
		return {
			outcome: { state: 'failed', code: err.code, details: err.details },
			enforced: policy.mode === 'enforce' ? err : null
		};
	}
}

const PENDING_TLOG_CODES: ReadonlySet<DirectoryVerificationCode> = new Set(['tlog_proof_missing']);

export function transitionFrom(
	stmt: DirectoryStatement,
	previousFingerprint: string
): StatementKeyTransition | undefined {
	const want = previousFingerprint.toLowerCase();
	return stmt.keyTransitions.find((t) => t.previousKeyFingerprint === want);
}

async function previousKeyMatching(
	previousKey: PreviousKeyInput | undefined,
	fingerprint: string
): Promise<string | null> {
	if (!previousKey?.publicKeyArmored) return null;
	try {
		const key = await openpgp.readKey({ armoredKey: previousKey.publicKeyArmored });
		return fingerprintHexOf(key) === fingerprint ? previousKey.publicKeyArmored : null;
	} catch {
		return null;
	}
}

export async function verifiedPreviousKey(
	stmt: DirectoryStatement,
	previousKey: PreviousKeyInput | undefined,
	fingerprint: string
): Promise<{ publicKeyArmored: string; transition: StatementKeyTransition } | null> {
	const transition = transitionFrom(stmt, fingerprint);
	if (!transition) return null;
	const armored = await previousKeyMatching(previousKey, transition.previousKeyFingerprint);
	if (!armored) return null;
	try {
		await verifyKeyTransition({
			accountId: stmt.accountId,
			newKeyFingerprint: stmt.keyFingerprint,
			previousKeyFingerprint: transition.previousKeyFingerprint,
			signature: transition.signature,
			previousPublicKeyArmored: armored
		});
	} catch {
		return null;
	}
	return { publicKeyArmored: armored, transition };
}

export async function verifyDirectoryLookup(
	lookup: LookupInputForVerification,
	requestedAddressNormalised: string,
	opts: VerifyOptions = {}
): Promise<DirectoryVerificationResult> {
	const requested = requestedAddressNormalised;
	const { bytes: raw, statement: stmt } = parseRaw(lookup.directoryStatementRaw, requested);

	if (stmt.signingKeyFingerprint !== DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase()) {
		throw new DirectoryVerificationError(
			'signing_key_mismatch',
			`statement signed by ${stmt.signingKeyFingerprint} but pinned key is ${DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX}`,
			{
				requestedAddress: requested,
				expectedSignerFingerprint: DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase(),
				actualSignerFingerprint: stmt.signingKeyFingerprint
			}
		);
	}

	await verifyDirectorySignature(raw, lookup.directorySignature, requested);

	const address = stmt.address.toLowerCase();
	if (address !== requested.toLowerCase()) {
		throw new DirectoryVerificationError(
			'address_mismatch',
			`statement address ${stmt.address} != requested ${requested}`,
			{ requestedAddress: requested, statementAddress: address }
		);
	}

	const servedKey = await readServedKey(lookup.publicKeyArmored, stmt, requested);
	if (!labelMatchesKey(stmt.keyAlgorithm, servedKey, stmt.issuedAt)) {
		throw new DirectoryVerificationError('algorithm_mismatch', `unsupported algorithm ${stmt.keyAlgorithm}`, {
			requestedAddress: requested,
			keyAlgorithm: stmt.keyAlgorithm,
			servedKeyAlgorithm: keyLabel(servedKey)
		});
	}

	const servedFp = fingerprintHexOf(servedKey);
	if (servedFp !== stmt.keyFingerprint) {
		throw new DirectoryVerificationError(
			'fingerprint_mismatch',
			`served key fp ${servedFp} != statement fp ${stmt.keyFingerprint}`,
			{
				requestedAddress: requested,
				signedKeyFingerprint: stmt.keyFingerprint,
				servedKeyFingerprint: servedFp
			}
		);
	}

	const { outcome: tlog, enforced } = await checkTlog(lookup, raw, requested);
	try {
		if (opts.pin === false) return await checkWithoutPin(lookup, stmt, address, requested, tlog, enforced);
		return await settlePin(lookup, stmt, address, requested, tlog, enforced, opts);
	} catch (e) {
		if (e instanceof DirectoryVerificationError && !e.tlog) e.tlog = tlog;
		throw e;
	}
}

type SeenRecord = Awaited<ReturnType<typeof getSeen>>;

function refuseRollback(seen: SeenRecord, stmt: DirectoryStatement, requested: string): void {
	const pinned = seen?.keyFingerprint.toLowerCase();
	const changed = seen != null && pinned !== stmt.keyFingerprint;
	if (seen && (stmt.version < seen.version || (changed && stmt.version === seen.version))) {
		throw new DirectoryVerificationError(
			'version_rolled_back',
			`statement version ${stmt.version} does not supersede last seen ${seen.version}`,
			{
				requestedAddress: requested,
				previousVersion: seen.version,
				currentVersion: stmt.version,
				previousFingerprint: pinned,
				currentFingerprint: stmt.keyFingerprint
			}
		);
	}
}

async function checkWithoutPin(
	lookup: LookupInputForVerification,
	stmt: DirectoryStatement,
	address: string,
	requested: string,
	tlog: TlogOutcome,
	enforced: DirectoryVerificationError | null
): Promise<DirectoryVerificationResult> {
	const seen = await getSeen(address);
	refuseRollback(seen, stmt, requested);
	if (enforced) throw enforced;
	return {
		statement: stmt,
		publicKeyArmored: lookup.publicKeyArmored,
		verifiedAt: new Date(),
		firstContact: seen == null,
		tlog
	};
}

async function settlePin(
	lookup: LookupInputForVerification,
	stmt: DirectoryStatement,
	address: string,
	requested: string,
	tlog: TlogOutcome,
	enforced: DirectoryVerificationError | null,
	opts: VerifyOptions
): Promise<DirectoryVerificationResult> {
	const seen = await getSeen(address);
	const pinned = seen?.keyFingerprint.toLowerCase();
	const changed = seen != null && pinned !== stmt.keyFingerprint;
	refuseRollback(seen, stmt, requested);

	let transition: KeyTransitionResult | undefined;
	if (seen && pinned && changed) {
		const changeDetails: DirectoryVerificationDetails = {
			requestedAddress: requested,
			previousFingerprint: pinned,
			currentFingerprint: stmt.keyFingerprint,
			previousVersion: seen.version,
			currentVersion: stmt.version,
			previousVerifiedAtMillis: seen.lastSeenAt
		};
		const accepted = opts.acceptFingerprint?.toLowerCase() === stmt.keyFingerprint;
		if (!accepted) {
			const element = transitionFrom(stmt, pinned);
			const prompt = (
				state: DirectoryVerificationDetails['transition'],
				tlogCode?: DirectoryVerificationCode
			) => {
				if (enforced) return enforced;
				return new DirectoryVerificationError(
					'fingerprint_changed',
					`statement key fp ${stmt.keyFingerprint} != last pinned ${pinned}`,
					{ ...changeDetails, transition: state, tlogCode }
				);
			};
			if (!element) throw prompt('absent');
			if (seen.accountId && seen.accountId !== stmt.accountId) throw prompt('account_changed');
			const previousArmored = await previousKeyMatching(lookup.previousKey, pinned);
			if (!previousArmored) throw prompt('previous_key_unavailable');
			try {
				await verifyKeyTransition({
					accountId: stmt.accountId,
					newKeyFingerprint: stmt.keyFingerprint,
					previousKeyFingerprint: pinned,
					signature: element.signature,
					previousPublicKeyArmored: previousArmored
				});
			} catch (e) {
				throw new DirectoryVerificationError(
					'key_transition_invalid',
					e instanceof Error ? e.message : 'endorsement does not verify',
					{
						...changeDetails,
						transitionError: e instanceof KeyTransitionError ? e.code : undefined
					}
				);
			}
			if (tlog.state !== 'verified') {
				const tlogCode = tlog.state === 'failed' ? tlog.code : undefined;
				if (!tlogCode || !PENDING_TLOG_CODES.has(tlogCode)) throw prompt('log_unverified', tlogCode);
				throw new DirectoryVerificationError('tlog_pending', 'the key change is not logged yet', {
					...changeDetails,
					retiredAtMillis: element.retiredAtMillis,
					tlogCode
				});
			}
			transition = {
				previousFingerprint: pinned,
				retiredAt: element.retiredAt,
				retiredAtMillis: element.retiredAtMillis
			};
		}
	}

	if (enforced) throw enforced;

	const now = Date.now();
	await upsertSeen({
		address,
		version: Math.max(stmt.version, seen?.version ?? 0),
		keyFingerprint: stmt.keyFingerprint,
		accountId: stmt.accountId,
		firstSeenAt: seen?.firstSeenAt ?? now,
		lastSeenAt: now
	});

	return {
		statement: stmt,
		publicKeyArmored: lookup.publicKeyArmored,
		verifiedAt: new Date(now),
		firstContact: seen == null,
		tlog,
		transition
	};
}
