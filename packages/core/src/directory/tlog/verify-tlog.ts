import { sha256 } from '@noble/hashes/sha2.js';
import { DirectoryVerificationError } from '../errors';
import { bytesEqual, bytesFromBase64, bytesToBase64, concatBytes, utf8 } from './bytes';
import { parseCheckpoint, type Checkpoint } from './checkpoint';
import { parseWitnessPolicy, verifyCosignature } from './cosignature';
import { leafHash, verifyConsistency, verifyInclusion } from './merkle';
import { findSignature, parseVerifierKey, verifyNoteSignature, type VerifierKey } from './note';
import { parseTlogProof, type TlogProofBundle } from './proof';
import type { TlogPolicy } from './policy';
import type { TlogStateStore } from './state-idb';
import { vrfVerify } from './vrf';

export interface TlogConsistencyProof {
	fromSize: number;
	toSize: number;
	hashes: string[];
}

export interface VerifyTlogOptions {
	nowMillis: number;
	store: TlogStateStore;
	consistency?: TlogConsistencyProof;
	refetchConsistency?: (since: number) => Promise<TlogConsistencyProof | undefined>;
}

export interface TlogProofDetails {
	origin: string;
	treeSize: number;
	leafIndex: number;
	validWitnessCount: number;
	witnessThreshold: number;
	cosignatureTimestamp?: number;
}

const FORWARD_SKEW_SECONDS = 300;

export async function verifyTlogProof(
	tlogProof: string | null | undefined,
	canonicalStatementBytes: Uint8Array,
	addressNormalised: string,
	policy: TlogPolicy,
	opts: VerifyTlogOptions
): Promise<TlogProofDetails> {
	if (!tlogProof) {
		throw new DirectoryVerificationError('tlog_proof_missing', 'lookup response has no tlogProof', {
			logOrigin: policy.origin
		});
	}

	let bundle: TlogProofBundle;
	let checkpoint: Checkpoint;
	try {
		bundle = parseTlogProof(tlogProof);
		checkpoint = parseCheckpoint(bundle.checkpointNote);
	} catch (e) {
		throw new DirectoryVerificationError(
			'tlog_proof_malformed',
			e instanceof Error ? e.message : 'cannot parse tlog proof',
			{ logOrigin: policy.origin }
		);
	}

	let logKey: VerifierKey;
	try {
		logKey = parseVerifierKey(policy.logVerifierKey);
	} catch (e) {
		throw new DirectoryVerificationError(
			'tlog_checkpoint_unverified',
			e instanceof Error ? e.message : 'invalid log verifier key',
			{ logOrigin: policy.origin }
		);
	}
	if (checkpoint.origin !== policy.origin) {
		throw new DirectoryVerificationError(
			'tlog_checkpoint_unverified',
			`checkpoint origin ${checkpoint.origin} != pinned ${policy.origin}`,
			{ logOrigin: checkpoint.origin }
		);
	}
	const logSig = findSignature(checkpoint.note, logKey);
	if (!logSig || !verifyNoteSignature(logSig, logKey, checkpoint.note.text)) {
		throw new DirectoryVerificationError(
			'tlog_checkpoint_unverified',
			'checkpoint is not signed by the pinned log key',
			{ logOrigin: policy.origin, treeSize: checkpoint.treeSize }
		);
	}

	let witnessKeys: VerifierKey[];
	try {
		witnessKeys = parseWitnessPolicy(policy.witnessVerifierKeys, policy.witnessThreshold);
	} catch (e) {
		throw new DirectoryVerificationError(
			'tlog_policy_invalid',
			e instanceof Error ? e.message : 'invalid witness policy',
			{ logOrigin: policy.origin, witnessThreshold: policy.witnessThreshold }
		);
	}

	const witnessTimestamps: number[] = [];
	for (const witnessKey of witnessKeys) {
		const sig = findSignature(checkpoint.note, witnessKey);
		if (!sig) continue;
		const timestamp = verifyCosignature(sig, witnessKey, checkpoint.note.text);
		if (timestamp !== null) witnessTimestamps.push(timestamp);
	}
	if (witnessTimestamps.length < policy.witnessThreshold) {
		throw new DirectoryVerificationError(
			'tlog_witness_policy_unmet',
			`${witnessTimestamps.length} valid witness cosignatures, need ${policy.witnessThreshold}`,
			{
				logOrigin: policy.origin,
				treeSize: checkpoint.treeSize,
				validWitnessCount: witnessTimestamps.length,
				witnessThreshold: policy.witnessThreshold
			}
		);
	}

	const nowSeconds = Math.floor(opts.nowMillis / 1000);
	const freshTimestamps = witnessTimestamps.filter(
		(timestamp) =>
			nowSeconds - timestamp <= policy.maxCosignatureAgeSeconds &&
			timestamp - nowSeconds <= FORWARD_SKEW_SECONDS
	);
	if (freshTimestamps.length < policy.witnessThreshold) {
		throw new DirectoryVerificationError(
			'tlog_checkpoint_stale',
			`${freshTimestamps.length} of ${witnessTimestamps.length} valid witness cosignatures inside freshness window, need ${policy.witnessThreshold}`,
			{
				logOrigin: policy.origin,
				treeSize: checkpoint.treeSize,
				validWitnessCount: freshTimestamps.length,
				witnessThreshold: policy.witnessThreshold,
				cosignatureTimestamp: Math.max(...witnessTimestamps)
			}
		);
	}

	let vrfPublicKey: Uint8Array;
	try {
		vrfPublicKey = bytesFromBase64(policy.vrfPublicKey);
	} catch {
		vrfPublicKey = new Uint8Array(0);
	}
	const beta = bundle.extra
		? vrfVerify(vrfPublicKey, bundle.extra, utf8(addressNormalised))
		: null;
	if (!beta) {
		throw new DirectoryVerificationError(
			'tlog_vrf_invalid',
			`VRF proof does not verify for ${addressNormalised}`,
			{ logOrigin: policy.origin, requestedAddress: addressNormalised }
		);
	}

	const entry = concatBytes(beta, sha256(canonicalStatementBytes));
	const treeSize = BigInt(checkpoint.treeSize);
	if (
		bundle.index >= treeSize ||
		!verifyInclusion(bundle.index, treeSize, leafHash(entry), bundle.path, checkpoint.rootHash)
	) {
		throw new DirectoryVerificationError(
			'tlog_inclusion_invalid',
			`inclusion proof for index ${bundle.index} does not match root at size ${checkpoint.treeSize}`,
			{
				logOrigin: policy.origin,
				treeSize: checkpoint.treeSize,
				leafIndex: Number(bundle.index)
			}
		);
	}

	await opts.store.exclusive(() => checkContinuity(checkpoint, policy.origin, opts));

	return {
		origin: policy.origin,
		treeSize: checkpoint.treeSize,
		leafIndex: Number(bundle.index),
		validWitnessCount: freshTimestamps.length,
		witnessThreshold: policy.witnessThreshold,
		cosignatureTimestamp: freshTimestamps.length ? Math.max(...freshTimestamps) : undefined
	};
}

function consistencyHolds(
	proof: TlogConsistencyProof | undefined,
	older: { treeSize: number; rootHash: Uint8Array },
	newer: { treeSize: number; rootHash: Uint8Array }
): boolean | undefined {
	if (!proof || proof.fromSize !== older.treeSize || proof.toSize !== newer.treeSize) {
		return undefined;
	}
	let hashes: Uint8Array[];
	try {
		hashes = proof.hashes.map(bytesFromBase64);
	} catch {
		return false;
	}
	if (hashes.some((h) => h.length !== 32)) return false;
	return verifyConsistency(
		BigInt(older.treeSize),
		older.rootHash,
		BigInt(newer.treeSize),
		newer.rootHash,
		hashes
	);
}

async function checkContinuity(
	checkpoint: Checkpoint,
	origin: string,
	opts: VerifyTlogOptions
): Promise<void> {
	const current = { treeSize: checkpoint.treeSize, rootHash: checkpoint.rootHash };
	const save = () =>
		opts.store.put({
			origin,
			treeSize: checkpoint.treeSize,
			rootHashB64: bytesToBase64(checkpoint.rootHash),
			updatedAt: opts.nowMillis
		});

	const stored = await opts.store.get(origin);
	if (!stored) {
		await save();
		return;
	}
	const details = {
		logOrigin: origin,
		treeSize: checkpoint.treeSize,
		previousTreeSize: stored.treeSize
	};
	let storedRoot: Uint8Array;
	try {
		storedRoot = bytesFromBase64(stored.rootHashB64);
	} catch {
		storedRoot = new Uint8Array(0);
	}
	if (storedRoot.length !== 32) {
		await save();
		return;
	}
	const previous = { treeSize: stored.treeSize, rootHash: storedRoot };

	if (checkpoint.treeSize === stored.treeSize) {
		if (!bytesEqual(checkpoint.rootHash, storedRoot)) {
			throw new DirectoryVerificationError(
				'tlog_checkpoint_conflict',
				`checkpoint root at tree size ${checkpoint.treeSize} differs from the one accepted before`,
				details
			);
		}
		return;
	}

	const grows = checkpoint.treeSize > stored.treeSize;
	const [older, newer] = grows ? [previous, current] : [current, previous];
	let holds = consistencyHolds(opts.consistency, older, newer);
	if (holds === undefined && opts.refetchConsistency) {
		holds = consistencyHolds(await opts.refetchConsistency(stored.treeSize), older, newer);
	}
	if (holds === undefined) {
		throw new DirectoryVerificationError(
			'tlog_consistency_unavailable',
			`no consistency proof between tree sizes ${older.treeSize} and ${newer.treeSize}`,
			details
		);
	}
	if (!holds) {
		throw grows
			? new DirectoryVerificationError(
					'tlog_consistency_invalid',
					`tree size ${checkpoint.treeSize} does not extend the accepted tree size ${stored.treeSize}`,
					details
				)
			: new DirectoryVerificationError(
					'tlog_tree_rolled_back',
					`tree size ${checkpoint.treeSize} is not a prefix of the accepted tree size ${stored.treeSize}`,
					details
				);
	}
	if (grows) await save();
}
