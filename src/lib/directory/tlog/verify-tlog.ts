import { sha256 } from '@noble/hashes/sha2.js';
import { DirectoryVerificationError } from '../errors';
import { bytesFromBase64, bytesToBase64, concatBytes, utf8 } from './bytes';
import { parseCheckpoint, type Checkpoint } from './checkpoint';
import { verifyCosignature } from './cosignature';
import { leafHash, verifyInclusion } from './merkle';
import { findSignature, parseVerifierKey, verifyNoteSignature, type VerifierKey } from './note';
import { parseTlogProof, type TlogProofBundle } from './proof';
import type { TlogPolicy } from './policy';
import type { TlogStateStore } from './state-idb';
import { vrfVerify } from './vrf';

export interface VerifyTlogOptions {
	nowMillis: number;
	store: TlogStateStore;
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

	const witnessTimestamps: number[] = [];
	for (const vkey of policy.witnessVerifierKeys ?? []) {
		let witnessKey: VerifierKey;
		try {
			witnessKey = parseVerifierKey(vkey);
		} catch {
			continue;
		}
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
	for (const timestamp of witnessTimestamps) {
		if (
			nowSeconds - timestamp > policy.maxCosignatureAgeSeconds ||
			timestamp - nowSeconds > FORWARD_SKEW_SECONDS
		) {
			throw new DirectoryVerificationError(
				'tlog_checkpoint_stale',
				`witness cosignature timestamp ${timestamp} outside freshness window`,
				{
					logOrigin: policy.origin,
					treeSize: checkpoint.treeSize,
					cosignatureTimestamp: timestamp
				}
			);
		}
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

	const stored = await opts.store.get(policy.origin);
	if (stored && checkpoint.treeSize < stored.treeSize) {
		throw new DirectoryVerificationError(
			'tlog_tree_rolled_back',
			`checkpoint tree size ${checkpoint.treeSize} < previously seen ${stored.treeSize}`,
			{
				logOrigin: policy.origin,
				treeSize: checkpoint.treeSize,
				previousTreeSize: stored.treeSize
			}
		);
	}
	await opts.store.put({
		origin: policy.origin,
		treeSize: checkpoint.treeSize,
		rootHashB64: bytesToBase64(checkpoint.rootHash),
		updatedAt: opts.nowMillis
	});

	return {
		origin: policy.origin,
		treeSize: checkpoint.treeSize,
		leafIndex: Number(bundle.index),
		validWitnessCount: witnessTimestamps.length,
		witnessThreshold: policy.witnessThreshold,
		cosignatureTimestamp: witnessTimestamps.length ? Math.max(...witnessTimestamps) : undefined
	};
}
