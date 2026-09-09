export type DirectoryVerificationCode =
	| 'signature_invalid'
	| 'address_mismatch'
	| 'fingerprint_mismatch'
	| 'algorithm_mismatch'
	| 'signing_key_mismatch'
	| 'version_rolled_back'
	| 'fingerprint_changed'
	| 'statement_malformed'
	| 'tlog_proof_missing'
	| 'tlog_proof_malformed'
	| 'tlog_checkpoint_unverified'
	| 'tlog_witness_policy_unmet'
	| 'tlog_checkpoint_stale'
	| 'tlog_inclusion_invalid'
	| 'tlog_vrf_invalid'
	| 'tlog_tree_rolled_back';

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
	logOrigin?: string;
	treeSize?: number;
	previousTreeSize?: number;
	leafIndex?: number;
	witnessThreshold?: number;
	validWitnessCount?: number;
	cosignatureTimestamp?: number;
}

export class DirectoryVerificationError extends Error {
	code: DirectoryVerificationCode;
	details: DirectoryVerificationDetails;
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
