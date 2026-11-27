export type ProfileId = 'account-authority-ed25519-v1' | 'calendar-identity-v1' | 'device-preview-current' | 'ingress-binding-v1' | 'legacy-import-amk-wrap-v1' | 'legacy-import-openpgp-curve25519-legacy' | 'legacy-import-openpgp-curve25519-v4' | 'legacy-import-srp-v1' | 'mail-classic-v1' | 'mail-import-dedup-v1' | 'mail-pq-v1' | 'mail-search-index-v1' | 'mail-search-root-v1' | 'opaque-current' | 'product-bundle-v1' | 'secret-wrap-v2';

export type ProfileStatus = 'admitted' | 'legacy-import' | 'recognized';

export type KeyUse = 'authenticate' | 'convert' | 'decrypt' | 'derive' | 'encrypt' | 'sign' | 'unwrap' | 'verify' | 'wrap';

export type CounterName = 'policy_version' | 'root_version' | 'auth_epoch' | 'session_epoch' | 'recovery_epoch' | 'amk_epoch' | 'key_epoch' | 'crypto_generation' | 'state_revision' | 'content_revision' | 'storage_revision' | 'device_generation';

export type SlotPurpose = 'password-amk' | 'recovery-amk' | 'passkey-amk';

export type WrapPurpose = SlotPurpose | 'secret-bundle';

export const PROFILE_IDS: readonly ProfileId[] = ['account-authority-ed25519-v1', 'calendar-identity-v1', 'device-preview-current', 'ingress-binding-v1', 'legacy-import-amk-wrap-v1', 'legacy-import-openpgp-curve25519-legacy', 'legacy-import-openpgp-curve25519-v4', 'legacy-import-srp-v1', 'mail-classic-v1', 'mail-import-dedup-v1', 'mail-pq-v1', 'mail-search-index-v1', 'mail-search-root-v1', 'opaque-current', 'product-bundle-v1', 'secret-wrap-v2'];

export const LEGACY_IMPORT_PREFIX = 'legacy-import-';

export const MAX_COUNTER = 9007199254740991;

export const COUNTERS: readonly CounterName[] = ['policy_version', 'root_version', 'auth_epoch', 'session_epoch', 'recovery_epoch', 'amk_epoch', 'key_epoch', 'crypto_generation', 'state_revision', 'content_revision', 'storage_revision', 'device_generation'];

export const LIMITS = {
	"maxPublicKeyBytes": 262144,
	"maxSecretBundleBytes": 1048576,
	"maxSignatureBytes": 65536,
	"maxAccountHeadBytes": 262144,
	"maxHistoryPageBytes": 1048576,
	"maxHistoryPageEntries": 128,
	"maxExternalRecipients": 64,
	"maxOwnerStorageRecipients": 1,
	"maxProfileIdBytes": 128
} as const;

export const SECRET_WRAP = {
	"version": 2,
	"kdf": "hkdf-sha256",
	"aead": "aes-256-gcm",
	"saltBytes": 32,
	"nonceBytes": 12,
	"tagBytes": 16,
	"amkBytes": 32,
	"minIkmBytes": 32,
	"digestBytes": 32,
	"maxBytes": 1048576,
	"labelPrefix": "thelemail/secret-wrap/v2/",
	"slotPurposes": [
		"password-amk",
		"recovery-amk",
		"passkey-amk"
	],
	"bundlePurpose": "secret-bundle",
	"slotFields": [
		"accountId",
		"aead",
		"amkEpoch",
		"ciphertext",
		"createdAuthEpoch",
		"credentialConfigDigest",
		"credentialGeneration",
		"credentialId",
		"kdf",
		"nonce",
		"purpose",
		"revision",
		"salt",
		"slotId",
		"version"
	],
	"bundleFields": [
		"accountId",
		"aead",
		"amkEpoch",
		"bundleId",
		"ciphertext",
		"kdf",
		"nonce",
		"purpose",
		"revision",
		"salt",
		"version"
	]
} as const;
