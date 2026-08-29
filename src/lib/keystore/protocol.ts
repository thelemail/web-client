import type { DecryptedAttachmentHeader } from '$lib/mail/attframe';

export interface AccountStatus {
	accountId: string;
	email: string;
	unlocked: boolean;
	hasPersistent: boolean;
	authScheme: 'srp_v1' | 'opaque_v1';
}

export interface StatusResponse {
	accounts: AccountStatus[];
}

export interface AccountScopedArgs {
	accountId: string;
}

export interface EnrollPersistentArgs extends AccountScopedArgs {
	serverHalf: string;
}

export interface TryRestoreFromPersistentArgs extends AccountScopedArgs {
	serverHalf: string;
}

export interface RestoreResponse {
	ok: boolean;
	accountId?: string;
	email?: string;
	reason?: 'no_persistent' | 'server_half_unavailable' | 'unwrap_failed';
}

export interface DecryptArgs extends AccountScopedArgs {
	ciphertextArmored?: string;
	ciphertextBinary?: Uint8Array;
	binary?: boolean;
	verificationKeysArmored?: string[];
	keyFingerprintHex?: string;
}

export type SignatureState = 'valid' | 'invalid' | 'none' | 'unknown_key';

export interface SignatureVerdict {
	state: SignatureState;
	keyFingerprintHex?: string;
	signedAtMillis?: number;
}

export type DecryptResponse =
	| { ok: true; plaintext: string; signature?: SignatureVerdict }
	| { ok: true; plaintextBinary: Uint8Array; signature?: SignatureVerdict }
	| { ok: false; code: 'locked' | 'invalid_ciphertext' | 'no_matching_key' | 'unknown' };

export type AttachmentFailureCode =
	| 'locked'
	| 'invalid_ciphertext'
	| 'no_matching_key'
	| 'network'
	| 'unknown';

export interface AttachmentHeaderArgs extends AccountScopedArgs {
	url: string;
	keyFingerprintHex?: string;
}

export type AttachmentHeaderResponse =
	| { ok: true; header: DecryptedAttachmentHeader }
	| { ok: false; code: AttachmentFailureCode };

export interface AttachmentBytesArgs extends AccountScopedArgs {
	url: string;
	keyFingerprintHex?: string;
}

export type AttachmentBytesResponse =
	| { ok: true; header: DecryptedAttachmentHeader; payload: Blob }
	| { ok: false; code: AttachmentFailureCode };

export interface GetPublicKeyArgs extends AccountScopedArgs {
	aliasId?: string;
}

export type GetPublicKeyResponse =
	| { ok: true; publicKeyArmored: string; fingerprint: Uint8Array }
	| { ok: false; code: 'locked' };

export interface ReformatKeyWithUidsArgs extends AccountScopedArgs {
	emails: string[];
}

export type ReformatKeyWithUidsResponse =
	| { ok: true; unchanged: true }
	| { ok: true; unchanged: false; publicKeyArmored: string; encryptedPrivateKey: string }
	| { ok: false; code: 'locked' | 'no_key_password' | 'fingerprint_changed' | 'no_emails' | 'unknown' };

export interface CommitReformattedKeyArgs extends AccountScopedArgs {
	encryptedPrivateKey: string;
}

export type CommitReformattedKeyResponse =
	| { ok: true }
	| { ok: false; code: 'locked' | 'no_key_password' | 'invalid' };

export interface EncryptArgs extends AccountScopedArgs {
	recipientPublicKeyArmored: string;
	plaintext: Uint8Array;
	signWithVaultKey?: boolean;
	aliasId?: string;
}

export type EncryptResponse =
	| { ok: true; ciphertext: Uint8Array }
	| { ok: false; code: 'locked' | 'invalid_recipient_key' | 'unknown' };

export interface EncryptToKeysArgs extends AccountScopedArgs {
	recipientPublicKeysArmored: string[];
	plaintext: Uint8Array;
	signWithVaultKey?: boolean;
	aliasId?: string;
}

export type EncryptToKeysResponse =
	| { ok: true; armored: string }
	| { ok: false; code: 'locked' | 'invalid_recipient_key' | 'no_recipients' | 'unknown' };

export interface PrepareLoginArgs {
	email: string;
	password: string;
	modulus: string;
	salt: string;
	serverPublicEphemeral: string;
}

export interface PrepareLoginResponse {
	clientPublicEphemeral: string;
	clientProof: string;
}

export interface VerifyLoginProofArgs {
	serverProof: string;
}

export type VerifyLoginProofResponse =
	| { ok: true }
	| { ok: false; code: 'invalid_credentials' | 'no_pending_login' };

export interface CompleteLoginUnlockArgs {
	accountId: string;
	encryptedPrivateKey: string;
	keySalt: string;
	srpSalt: string;
}

export type CompleteLoginUnlockResponse =
	| { ok: true; accountId: string; email: string }
	| { ok: false; code: 'no_pending_login' | 'proof_not_verified' | 'invalid_credentials' };

export interface PrepareRegisterArgs {
	email: string;
	password: string;
	modulus: string;
}

export interface PrepareRegisterResponse {
	srpSalt: string;
	srpVerifier: string;
	keySalt: string;
	publicKey: string;
	encryptedPrivateKey: string;
	keyAlgorithm: 'openpgp-curve25519-v6';
}

export interface FinalizeRegisterArgs {
	accountId: string;
}

export type FinalizeRegisterResponse =
	| { ok: true; accountId: string; email: string }
	| { ok: false; code: 'no_pending_register' | 'unwrap_failed' };

export interface PrepareRecoverySetupArgs extends AccountScopedArgs {
	modulus: string;
}

export type PrepareRecoverySetupResponse =
	| {
			ok: true;
			phrase: string;
			srpSalt: string;
			srpVerifier: string;
			keySalt: string;
			encryptedPrivateKey: string;
	  }
	| { ok: false; code: 'locked' };

export interface PrepareRecoveryLoginArgs {
	email: string;
	phrase: string;
	modulus: string;
	salt: string;
	serverPublicEphemeral: string;
}

export interface PrepareRecoveryLoginResponse {
	clientPublicEphemeral: string;
	clientProof: string;
}

export interface VerifyRecoveryProofArgs {
	serverProof: string;
}

export type VerifyRecoveryProofResponse =
	| { ok: true }
	| { ok: false; code: 'invalid_credentials' | 'no_pending_recovery' };

export interface CompleteRecoveryUnlockArgs {
	encryptedPrivateKey: string;
	keySalt: string;
	resetTokenExpiresInSeconds: number;
}

export type CompleteRecoveryUnlockResponse =
	| { ok: true }
	| { ok: false; code: 'no_pending_recovery' | 'proof_not_verified' | 'invalid_credentials' };

export interface PrepareCredentialResetArgs {
	newPassword: string;
	modulus: string;
}

export type PrepareCredentialResetResponse =
	| {
			ok: true;
			srpSalt: string;
			srpVerifier: string;
			keySalt: string;
			encryptedPrivateKey: string;
	  }
	| { ok: false; code: 'no_pending_reset' | 'reset_expired' };

export interface PreparePasswordChangeProofArgs extends AccountScopedArgs {
	currentPassword: string;
	modulus: string;
	salt: string;
	serverPublicEphemeral: string;
}

export type PreparePasswordChangeProofResponse =
	| { ok: true; clientPublicEphemeral: string; clientProof: string }
	| { ok: false; code: 'locked' };

export interface PrepareDeletionProofArgs extends AccountScopedArgs {
	password: string;
	modulus: string;
	salt: string;
	serverPublicEphemeral: string;
}

export type PrepareDeletionProofResponse =
	| {
			ok: true;
			clientPublicEphemeral: string;
			clientProof: string;
			expectedServerProof: string;
	  }
	| { ok: false; code: 'locked' };

export interface VerifyPasswordChangeProofArgs {
	serverProof: string;
}

export type VerifyPasswordChangeProofResponse =
	| { ok: true }
	| { ok: false; code: 'invalid_credentials' | 'no_pending_change' };

export interface PreparePasswordChangeCredentialsArgs extends AccountScopedArgs {
	newPassword: string;
	modulus: string;
}

export type PreparePasswordChangeCredentialsResponse =
	| {
			ok: true;
			srpSalt: string;
			srpVerifier: string;
			keySalt: string;
			encryptedPrivateKey: string;
	  }
	| { ok: false; code: 'locked' | 'no_pending_change' | 'proof_not_verified' | 'change_expired' };

export type CommitPasswordChangeArgs = AccountScopedArgs;

export type CommitPasswordChangeResponse =
	| { ok: true; persisted: boolean }
	| { ok: false; code: 'no_pending_change' | 'locked' };

export type InvalidatePersistedVaultArgs = AccountScopedArgs;

export type LockArgs = AccountScopedArgs;
export type ClearArgs = AccountScopedArgs;
export type DisablePersistentArgs = AccountScopedArgs;

export interface VaultChangedBroadcast {
	type: 'vaultChanged';
	accountId: string;
	email: string;
}

export interface LockedBroadcast {
	type: 'locked';
	accountId: string;
}

export interface ClearedBroadcast {
	type: 'cleared';
	accountId: string;
}

export interface ClearedAllBroadcast {
	type: 'clearedAll';
}

export interface PersistentDisabledBroadcast {
	type: 'persistentDisabled';
	accountId: string;
}

export interface AliasKeysChangedBroadcast {
	type: 'aliasKeysChanged';
	accountId: string;
	fingerprints: string[];
}

export type Broadcast =
	| VaultChangedBroadcast
	| LockedBroadcast
	| ClearedBroadcast
	| ClearedAllBroadcast
	| PersistentDisabledBroadcast
	| AliasKeysChangedBroadcast;

export interface OpaqueStartRegistrationArgs {
	email: string;
	password: string;
}

export interface OpaqueStartRegistrationResponse {
	operationId: string;
	registrationRequest: string;
}

export interface OpaqueFinishRegistrationArgs {
	operationId: string;
	accountId: string;
	registrationResponse: string;
}

export type OpaqueFinishRegistrationResponse =
	| {
			ok: true;
			opaqueRecord: string;
			wrappedMasterKey: string;
			masterKeyId: string;
			opaqueParamsVersion: number;
			publicKey: string;
			encryptedPrivateKey: string;
			keyAlgorithm: 'openpgp-curve25519-v6';
	  }
	| { ok: false; code: 'no_pending_operation' };

export interface OpaqueFinalizeRegisterArgs {
	operationId: string;
	accountId: string;
}

export type OpaqueFinalizeRegisterResponse =
	| { ok: true; accountId: string; email: string }
	| { ok: false; code: 'no_pending_operation' | 'unwrap_failed' };

export interface OpaqueAbandonOperationArgs {
	operationId: string;
}

export interface OpaqueStartAuthArgs {
	password: string;
	email?: string;
	recovery?: boolean;
}

export interface OpaqueStartAuthResponse {
	operationId: string;
	ke1: string;
}

export interface OpaqueFinishAuthArgs {
	operationId: string;
	accountId: string;
	ke2: string;
	recovery?: boolean;
}

export type OpaqueFinishAuthResponse =
	| { ok: true; ke3: string }
	| { ok: false; code: 'invalid_credentials' | 'no_pending_operation' };

export interface OpaqueCompleteLoginUnlockArgs {
	operationId: string;
	accountId: string;
	encryptedPrivateKey: string;
	wrappedMasterKey: string;
	masterKeyId: string;
	opaqueParamsVersion: number;
	serverAuthScheme: 'srp_v1' | 'opaque_v1';
}

export type OpaqueCompleteLoginUnlockResponse =
	| { ok: true; accountId: string; email: string }
	| { ok: false; code: 'no_pending_operation' | 'unwrap_failed' | 'master_key_mismatch' };

export interface MigrationStartRegistrationArgs extends AccountScopedArgs {
	password: string;
}

export type MigrationStartRegistrationResponse =
	| { ok: true; operationId: string; registrationRequest: string }
	| { ok: false; code: 'locked' };

export interface MigrationFinishStageArgs extends AccountScopedArgs {
	operationId: string;
	registrationResponse: string;
}

export type MigrationFinishStageResponse =
	| {
			ok: true;
			opaqueRecord: string;
			wrappedMasterKey: string;
			masterKeyId: string;
			opaqueParamsVersion: number;
			stagedEncryptedPrivateKey: string;
	  }
	| { ok: false; code: 'locked' | 'no_pending_operation' };

export type OpaqueRecoverySetupStartArgs = AccountScopedArgs;

export type OpaqueRecoverySetupStartResponse =
	| { ok: true; operationId: string; phrase: string; registrationRequest: string }
	| { ok: false; code: 'locked' };

export interface OpaqueRecoverySetupFinishArgs extends AccountScopedArgs {
	operationId: string;
	registrationResponse: string;
}

export type OpaqueRecoverySetupFinishResponse =
	| {
			ok: true;
			opaqueRecord: string;
			wrappedMasterKey: string;
			masterKeyId: string;
			opaqueParamsVersion: number;
	  }
	| { ok: false; code: 'locked' | 'no_pending_operation' };

export interface OpaqueCompleteRecoveryUnlockArgs {
	operationId: string;
	encryptedPrivateKey: string;
	wrappedMasterKey: string;
	resetTokenExpiresInSeconds: number;
}

export type OpaqueCompleteRecoveryUnlockResponse =
	| { ok: true }
	| { ok: false; code: 'no_pending_operation' | 'invalid_credentials' };

export interface OpaquePrepareCredentialResetArgs {
	operationId: string;
	newPassword: string;
}

export type OpaquePrepareCredentialResetResponse =
	| { ok: true; registrationRequest: string }
	| { ok: false; code: 'no_pending_reset' };

export interface OpaqueFinishCredentialResetArgs {
	operationId: string;
	registrationResponse: string;
}

export type OpaqueFinishCredentialResetResponse =
	| { ok: true; opaqueRecord: string; wrappedMasterKey: string; masterKeyId: string; opaqueParamsVersion: number }
	| { ok: false; code: 'no_pending_reset' };

export interface OpaquePrepareAmkRotationArgs extends AccountScopedArgs {
	newPassword: string;
}

export type OpaquePrepareAmkRotationResponse =
	| { ok: true; operationId: string; registrationRequest: string }
	| { ok: false; code: 'no_pending_reset' };

export interface OpaqueFinishAmkRotationArgs {
	operationId: string;
	registrationResponse: string;
}

export type OpaqueFinishAmkRotationResponse =
	| {
			ok: true;
			opaqueRecord: string;
			wrappedMasterKey: string;
			masterKeyId: string;
			opaqueParamsVersion: number;
			encryptedPrivateKey: string;
	  }
	| { ok: false; code: 'no_pending_reset' | 'no_pending_operation' };

export interface OpaquePasswordChangeStartArgs extends AccountScopedArgs {
	newPassword: string;
}

export type OpaquePasswordChangeStartResponse =
	| { ok: true; operationId: string; registrationRequest: string }
	| { ok: false; code: 'locked' };

export interface OpaquePasswordChangeFinishArgs extends AccountScopedArgs {
	operationId: string;
	registrationResponse: string;
}

export type OpaquePasswordChangeFinishResponse =
	| { ok: true; opaqueRecord: string; wrappedMasterKey: string; masterKeyId: string; opaqueParamsVersion: number }
	| { ok: false; code: 'locked' | 'no_pending_operation' };

export interface OpaquePasswordChangeCommitArgs extends AccountScopedArgs {
	operationId: string;
}

export type OpaquePasswordChangeCommitResponse =
	| { ok: true; persisted: boolean }
	| { ok: false; code: 'locked' | 'no_pending_operation' };

export interface AliasKeyGrantInput {
	aliasId: string;
	addressId: string;
	email: string;
	name: string;
	keyVersion: number;
	aliasKeyFingerprintHex: string;
	wrappedPrivateKeyArmored: string;
	isCurrent: boolean;
}

export interface LoadAliasKeysArgs extends AccountScopedArgs {
	grants: AliasKeyGrantInput[];
}

export type LoadAliasKeysResponse =
	| { ok: true; loaded: string[]; failed: { aliasId: string; keyVersion: number }[] }
	| { ok: false; code: 'locked' };

export type UnloadAliasKeysArgs = AccountScopedArgs;

export interface CreateAliasKeyRecipient {
	accountId: string;
	publicKeyArmored: string;
}

export interface CreateAliasKeyArgs extends AccountScopedArgs {
	email: string;
	displayName: string;
	recipients: CreateAliasKeyRecipient[];
}

export interface CreatedAliasKeyGrant {
	accountId: string;
	wrappedPrivateKeyArmored: string;
	memberKeyFingerprintHex: string;
}

export type CreateAliasKeyResponse =
	| {
			ok: true;
			publicKeyArmored: string;
			keyFingerprintHex: string;
			grants: CreatedAliasKeyGrant[];
	  }
	| { ok: false; code: 'locked' | 'invalid_recipient_key' | 'no_recipients' | 'unknown' };
