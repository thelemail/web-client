import type { StatementErrorKind } from './statement';
import type { KeyTransitionErrorCode } from './key-transition';
import type { TlogProofDetails } from './tlog/verify-tlog';

export type DirectoryVerificationCode =
	| 'signature_invalid'
	| 'address_mismatch'
	| 'fingerprint_mismatch'
	| 'algorithm_mismatch'
	| 'signing_key_mismatch'
	| 'version_rolled_back'
	| 'fingerprint_changed'
	| 'key_transition_invalid'
	| 'tlog_pending'
	| 'statement_malformed'
	| 'tlog_proof_missing'
	| 'tlog_proof_malformed'
	| 'tlog_checkpoint_unverified'
	| 'tlog_witness_policy_unmet'
	| 'tlog_policy_invalid'
	| 'tlog_checkpoint_stale'
	| 'tlog_inclusion_invalid'
	| 'tlog_vrf_invalid'
	| 'tlog_tree_rolled_back'
	| 'tlog_checkpoint_conflict'
	| 'tlog_consistency_unavailable'
	| 'tlog_consistency_invalid';

export type KeyTransitionState = 'absent' | 'account_changed' | 'previous_key_unavailable';

export interface DirectoryVerificationDetails {
	statementAddress?: string;
	requestedAddress?: string;
	signedKeyFingerprint?: string;
	servedKeyFingerprint?: string;
	expectedSignerFingerprint?: string;
	actualSignerFingerprint?: string;
	previousFingerprint?: string;
	currentFingerprint?: string;
	previousVersion?: number;
	currentVersion?: number;
	previousVerifiedAtMillis?: number;
	keyAlgorithm?: string;
	servedKeyAlgorithm?: string;
	statementError?: StatementErrorKind | 'missing';
	statementField?: string;
	transition?: KeyTransitionState;
	transitionError?: KeyTransitionErrorCode;
	retiredAtMillis?: number;
	tlogCode?: DirectoryVerificationCode;
	logOrigin?: string;
	treeSize?: number;
	previousTreeSize?: number;
	leafIndex?: number;
	witnessThreshold?: number;
	validWitnessCount?: number;
	cosignatureTimestamp?: number;
}

export type TlogOutcome =
	| ({ state: 'verified' } & TlogProofDetails)
	| { state: 'not_configured' }
	| {
			state: 'failed';
			code: DirectoryVerificationCode;
			details: DirectoryVerificationDetails;
	  };

export class DirectoryVerificationError extends Error {
	code: DirectoryVerificationCode;
	details: DirectoryVerificationDetails;
	tlog?: TlogOutcome;
	constructor(
		code: DirectoryVerificationCode,
		message?: string,
		details: DirectoryVerificationDetails = {}
	) {
		super(message ?? code);
		this.code = code;
		this.details = details;
		this.name = 'DirectoryVerificationError';
	}
}
