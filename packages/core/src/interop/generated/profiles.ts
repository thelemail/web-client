export type ProfileId = 'account-authority-ed25519-v1' | 'calendar-identity-v1' | 'device-preview-current' | 'ingress-binding-v1' | 'legacy-import-amk-wrap-v1' | 'legacy-import-openpgp-curve25519-legacy' | 'legacy-import-openpgp-curve25519-v4' | 'legacy-import-srp-v1' | 'mail-classic-v1' | 'mail-import-dedup-v1' | 'mail-pq-v1' | 'mail-search-index-v1' | 'mail-search-root-v1' | 'opaque-current' | 'product-bundle-v1' | 'secret-wrap-v2';

export type ProfileStatus = 'admitted' | 'legacy-import' | 'recognized';

export type KeyUse = 'authenticate' | 'convert' | 'decrypt' | 'derive' | 'encrypt' | 'sign' | 'unwrap' | 'verify' | 'wrap';

export type CounterName = 'policy_version' | 'root_version' | 'auth_epoch' | 'session_epoch' | 'recovery_epoch' | 'amk_epoch' | 'key_epoch' | 'crypto_generation' | 'state_revision' | 'content_revision' | 'storage_revision' | 'device_generation';

export type SlotPurpose = 'password-amk' | 'recovery-amk' | 'passkey-amk';

export type WrapPurpose = SlotPurpose | 'secret-bundle';

export interface ProfileLimits {
	readonly maxPublicKeyBytes: number;
	readonly maxPrivateKeyBytes: number;
	readonly maxSignatureBytes: number;
	readonly maxPayloadBytes: number;
	readonly maxRecipients: number;
}

export interface Profile {
	readonly id: ProfileId;
	readonly protocolVersion: number;
	readonly status: ProfileStatus;
	readonly purpose: string;
	readonly construction: string;
	readonly primitives: readonly string[];
	readonly parameters: readonly { readonly name: string; readonly value: string }[];
	readonly keyUses: readonly KeyUse[];
	readonly limits: ProfileLimits;
	readonly packetGrammar: readonly string[];
	readonly permissions: { readonly create: boolean; readonly decrypt: boolean; readonly verify: boolean };
	readonly dependencies: readonly ProfileId[];
	readonly conversionEdges: readonly ProfileId[];
	readonly vectorFiles: readonly string[];
	readonly dependencyReleases: readonly { readonly module: string; readonly version: string }[];
	readonly admitted: string;
	readonly newWriteCutoff: string;
	readonly activeReadCutoff: string;
	readonly incidentStatus: string;
	readonly securityClaim: string;
	readonly attackPath: readonly string[];
}

function freeze<T>(v: T): T {
	if (v && typeof v === 'object') {
		for (const k of Object.keys(v)) freeze((v as Record<string, unknown>)[k]);
		Object.freeze(v);
	}
	return v;
}

export const PROFILE_IDS: readonly ProfileId[] = freeze(['account-authority-ed25519-v1', 'calendar-identity-v1', 'device-preview-current', 'ingress-binding-v1', 'legacy-import-amk-wrap-v1', 'legacy-import-openpgp-curve25519-legacy', 'legacy-import-openpgp-curve25519-v4', 'legacy-import-srp-v1', 'mail-classic-v1', 'mail-import-dedup-v1', 'mail-pq-v1', 'mail-search-index-v1', 'mail-search-root-v1', 'opaque-current', 'product-bundle-v1', 'secret-wrap-v2']);

export const LEGACY_IMPORT_PREFIX = 'legacy-import-';

export const MAX_COUNTER = 9007199254740991;

export const COUNTERS: readonly CounterName[] = freeze(['policy_version', 'root_version', 'auth_epoch', 'session_epoch', 'recovery_epoch', 'amk_epoch', 'key_epoch', 'crypto_generation', 'state_revision', 'content_revision', 'storage_revision', 'device_generation']);

export const LIMITS = freeze({
	"maxPublicKeyBytes": 262144,
	"maxSecretBundleBytes": 1048576,
	"maxSignatureBytes": 65536,
	"maxAccountHeadBytes": 262144,
	"maxHistoryPageBytes": 1048576,
	"maxHistoryPageEntries": 128,
	"maxExternalRecipients": 64,
	"maxOwnerStorageRecipients": 1,
	"maxProfileIdBytes": 128
});

export const SECRET_WRAP = freeze({
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
} as {
	readonly version: 2;
	readonly kdf: 'hkdf-sha256';
	readonly aead: 'aes-256-gcm';
	readonly saltBytes: number;
	readonly nonceBytes: number;
	readonly tagBytes: number;
	readonly amkBytes: number;
	readonly minIkmBytes: number;
	readonly digestBytes: number;
	readonly maxBytes: number;
	readonly labelPrefix: string;
	readonly slotPurposes: readonly SlotPurpose[];
	readonly bundlePurpose: 'secret-bundle';
	readonly slotFields: readonly string[];
	readonly bundleFields: readonly string[];
});

export const PROFILES: Readonly<Record<ProfileId, Profile>> = freeze({
	'account-authority-ed25519-v1': {
		"id": "account-authority-ed25519-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "account authority key that signs account heads and delegations",
		"construction": "OpenPGP v6 Ed25519 primary key with no subkeys, signing flag only",
		"primitives": [
			"ed25519",
			"sha-256"
		],
		"parameters": [
			{
				"name": "keyVersion",
				"value": "6"
			}
		],
		"keyUses": [
			"sign",
			"verify"
		],
		"limits": {
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"v6 public key: primary and self-signature, no user IDs, no subkeys"
		],
		"permissions": {
			"create": true,
			"decrypt": false,
			"verify": true
		},
		"dependencies": [
			"secret-wrap-v2"
		],
		"conversionEdges": [],
		"vectorFiles": [
			"product-keys-v1.json"
		],
		"dependencyReleases": [
			{
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "classical authenticity of account heads",
		"attackPath": [
			"authority secret key sits in an AMK-encrypted secret bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'calendar-identity-v1': {
		"id": "calendar-identity-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "calendar product identity",
		"construction": "OpenPGP v6 Ed25519 primary signing key with exactly one X25519 encryption subkey",
		"primitives": [
			"ed25519",
			"x25519"
		],
		"parameters": [
			{
				"name": "keyVersion",
				"value": "6"
			}
		],
		"keyUses": [
			"sign",
			"verify",
			"encrypt",
			"decrypt"
		],
		"limits": {
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"v6 public key: primary, self-signature, one encryption subkey"
		],
		"permissions": {
			"create": true,
			"decrypt": true,
			"verify": true
		},
		"dependencies": [
			"product-bundle-v1"
		],
		"conversionEdges": [],
		"vectorFiles": [
			"product-keys-v1.json",
			"calendar-signatures-v1.json"
		],
		"dependencyReleases": [
			{
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "classical confidentiality and authenticity of calendar data",
		"attackPath": [
			"calendar private key sits in a product bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'device-preview-current': {
		"id": "device-preview-current",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "short-lived per-device push notification previews",
		"construction": "x25519-hkdf-sha256-aes256gcm: ephemeral X25519 to the device preview key, HKDF-SHA-256 info \"thelemail-preview-v1\", AES-256-GCM with a 12-byte nonce, AAD accountId 0x1f messageId",
		"primitives": [
			"x25519",
			"hkdf-sha256",
			"aes-256-gcm"
		],
		"parameters": [
			{
				"name": "publicKeyBytes",
				"value": "32"
			},
			{
				"name": "nonceBytes",
				"value": "12"
			}
		],
		"keyUses": [
			"encrypt",
			"decrypt"
		],
		"limits": {
			"maxPublicKeyBytes": 32,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 1
		},
		"packetGrammar": [
			"ephemeralPublicKey || nonce || ciphertext"
		],
		"permissions": {
			"create": true,
			"decrypt": true,
			"verify": false
		},
		"dependencies": [],
		"conversionEdges": [],
		"vectorFiles": [],
		"dependencyReleases": [
			{
				"module": "go",
				"version": "1.27.4"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "classical confidentiality of a short preview to one device; cannot support a whole-product post-quantum claim",
		"attackPath": [
			"device preview private key stays in the device keystore"
		]
	},
	'ingress-binding-v1': {
		"id": "ingress-binding-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "attests that ingress associated a stored object with an account",
		"construction": "raw Ed25519 signature over the storage-binding transcript with a dedicated Vault transit key; public keys distributed by scoped TUF policy",
		"primitives": [
			"ed25519"
		],
		"parameters": [
			{
				"name": "signatureBytes",
				"value": "64"
			}
		],
		"keyUses": [
			"sign",
			"verify"
		],
		"limits": {
			"maxPublicKeyBytes": 32,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 64,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"64-byte Ed25519 signature"
		],
		"permissions": {
			"create": true,
			"decrypt": false,
			"verify": true
		},
		"dependencies": [],
		"conversionEdges": [],
		"vectorFiles": [],
		"dependencyReleases": [
			{
				"module": "go",
				"version": "1.27.4"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "authorized ingress association only, not external sender authorship",
		"attackPath": [
			"Vault transit key compromise forges bindings until its separate rotation"
		]
	},
	'legacy-import-amk-wrap-v1': {
		"id": "legacy-import-amk-wrap-v1",
		"protocolVersion": 1,
		"status": "legacy-import",
		"purpose": "historical binary AMK wrappers awaiting secret-wrap-v2 slots",
		"construction": "HKDF-SHA-256 with empty salt and info \"thelemail/amk-wrap/v1\" or \"thelemail/amk-wrap/recovery/v1\", AES-256-GCM with the info as AAD, encoded 0x01 || nonce || ciphertext",
		"primitives": [
			"hkdf-sha256",
			"aes-256-gcm"
		],
		"parameters": [
			{
				"name": "wrapperBytes",
				"value": "61"
			}
		],
		"keyUses": [
			"unwrap",
			"convert"
		],
		"limits": {
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 61,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"0x01 || nonce12 || ciphertext32 || tag16"
		],
		"permissions": {
			"create": false,
			"decrypt": true,
			"verify": false
		},
		"dependencies": [
			"opaque-current"
		],
		"conversionEdges": [
			"secret-wrap-v2"
		],
		"vectorFiles": [],
		"dependencyReleases": [
			{
				"module": "go",
				"version": "1.27.4"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "read and convert only; the wrapper binds no account, epoch or slot context",
		"attackPath": [
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot"
		]
	},
	'legacy-import-openpgp-curve25519-legacy': {
		"id": "legacy-import-openpgp-curve25519-legacy",
		"protocolVersion": 1,
		"status": "legacy-import",
		"purpose": "historical v4 keys from the pre-RFC 9580 Curve25519 encodings",
		"construction": "OpenPGP v4 EdDSALegacy (algorithm 22) primary key with ECDH (algorithm 18) Curve25519 subkey, v1 SEIPD",
		"primitives": [
			"ed25519",
			"x25519",
			"aes-256",
			"sha-256"
		],
		"parameters": [
			{
				"name": "keyVersion",
				"value": "4"
			},
			{
				"name": "signatureAlgorithm",
				"value": "22"
			},
			{
				"name": "encryptionAlgorithm",
				"value": "18"
			}
		],
		"keyUses": [
			"verify",
			"decrypt",
			"convert"
		],
		"limits": {
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 262144,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"PKESKv3+ SEIPDv1",
			"v4 signature"
		],
		"permissions": {
			"create": false,
			"decrypt": true,
			"verify": true
		},
		"dependencies": [],
		"conversionEdges": [
			"mail-classic-v1"
		],
		"vectorFiles": [
			"key-labels.json"
		],
		"dependencyReleases": [
			{
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "read, verify and convert only; v1 SEIPD prefixes are unauthenticated until the whole message verifies",
		"attackPath": [
			"legacy private key sits in the account vault",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'legacy-import-openpgp-curve25519-v4': {
		"id": "legacy-import-openpgp-curve25519-v4",
		"protocolVersion": 1,
		"status": "legacy-import",
		"purpose": "historical v4 keys with RFC 9580 Ed25519 and X25519 algorithms",
		"construction": "OpenPGP v4 Ed25519 (algorithm 27) primary key with X25519 (algorithm 25) subkey",
		"primitives": [
			"ed25519",
			"x25519",
			"aes-256",
			"sha-256"
		],
		"parameters": [
			{
				"name": "keyVersion",
				"value": "4"
			}
		],
		"keyUses": [
			"verify",
			"decrypt",
			"convert"
		],
		"limits": {
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 262144,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"PKESKv3+ SEIPDv1",
			"v4 signature"
		],
		"permissions": {
			"create": false,
			"decrypt": true,
			"verify": true
		},
		"dependencies": [],
		"conversionEdges": [
			"mail-classic-v1"
		],
		"vectorFiles": [
			"key-labels.json"
		],
		"dependencyReleases": [
			{
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "read, verify and convert only; v1 SEIPD prefixes are unauthenticated until the whole message verifies",
		"attackPath": [
			"legacy private key sits in the account vault",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'legacy-import-srp-v1': {
		"id": "legacy-import-srp-v1",
		"protocolVersion": 1,
		"status": "legacy-import",
		"purpose": "historical SRP password and recovery verifiers awaiting OPAQUE re-registration",
		"construction": "ProtonMail SRP-6a with bcrypt-hashed password",
		"primitives": [
			"srp-6a",
			"bcrypt"
		],
		"parameters": [],
		"keyUses": [
			"authenticate",
			"convert"
		],
		"limits": {
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"SRP verifier and salt"
		],
		"permissions": {
			"create": false,
			"decrypt": false,
			"verify": true
		},
		"dependencies": [],
		"conversionEdges": [
			"opaque-current"
		],
		"vectorFiles": [],
		"dependencyReleases": [
			{
				"module": "github.com/ProtonMail/go-srp",
				"version": "v0.0.7"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "read and convert only; never a new registration",
		"attackPath": [
			"stored verifier is an offline password-guessing oracle until revoked"
		]
	},
	'mail-classic-v1': {
		"id": "mail-classic-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "internal mailbox, alias and shared-scope OpenPGP keys and payloads",
		"construction": "OpenPGP v6 Ed25519 primary signing key, X25519 encryption subkey, v6 PKESK, v2 SEIPD with AES-256 and OCB, 64 KiB AEAD chunks, no compression, SHA-256 signatures unless the operation requires a standard-defined alternative",
		"primitives": [
			"ed25519",
			"x25519",
			"aes-256",
			"ocb",
			"sha-256"
		],
		"parameters": [
			{
				"name": "keyVersion",
				"value": "6"
			},
			{
				"name": "seipdVersion",
				"value": "2"
			},
			{
				"name": "aeadChunkBytes",
				"value": "65536"
			},
			{
				"name": "compression",
				"value": "none"
			}
		],
		"keyUses": [
			"sign",
			"verify",
			"encrypt",
			"decrypt"
		],
		"limits": {
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 262144,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 64
		},
		"packetGrammar": [
			"PKESKv6+ SEIPDv2",
			"v6 detached signature",
			"v6 public key: primary, self-signatures, one encryption subkey"
		],
		"permissions": {
			"create": true,
			"decrypt": true,
			"verify": true
		},
		"dependencies": [],
		"conversionEdges": [
			"mail-pq-v1"
		],
		"vectorFiles": [
			"key-labels.json",
			"attachments.json"
		],
		"dependencyReleases": [
			{
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "classical confidentiality and authenticity of mail payloads against an adversary without a quantum computer",
		"attackPath": [
			"mailbox private key sits in an AMK-encrypted secret bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'mail-import-dedup-v1': {
		"id": "mail-import-dedup-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "stable import deduplication secret kept independent of the AMK",
		"construction": "32-byte secret stored as a product bundle entry; accounts that predate it carry SHA-256(\"thelemail/import-dedup-key/v1\" || 0x00 || key password)",
		"primitives": [
			"sha-256"
		],
		"parameters": [
			{
				"name": "secretBytes",
				"value": "32"
			}
		],
		"keyUses": [
			"derive"
		],
		"limits": {
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"product bundle entry"
		],
		"permissions": {
			"create": true,
			"decrypt": true,
			"verify": false
		},
		"dependencies": [
			"product-bundle-v1"
		],
		"conversionEdges": [],
		"vectorFiles": [
			"product-keys-read-v1.json"
		],
		"dependencyReleases": [
			{
				"module": "go",
				"version": "1.27.4"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "import identity survives AMK rotation",
		"attackPath": [
			"secret sits in a product bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'mail-pq-v1': {
		"id": "mail-pq-v1",
		"protocolVersion": 1,
		"status": "recognized",
		"purpose": "next internal mailbox profile; recognized for parsing only until admitted",
		"construction": "OpenPGP v6, RFC 9980 ML-DSA-65+Ed25519 primary signature algorithm 30, ML-KEM-768+X25519 encryption algorithm 35, v6 PKESK, v2 SEIPD with AES-256 and OCB, hash handling exactly as RFC 9980 mandates, no classical-only alternative PKESK",
		"primitives": [
			"ml-dsa-65",
			"ed25519",
			"ml-kem-768",
			"x25519",
			"aes-256",
			"ocb"
		],
		"parameters": [
			{
				"name": "signatureAlgorithm",
				"value": "30"
			},
			{
				"name": "encryptionAlgorithm",
				"value": "35"
			},
			{
				"name": "keyVersion",
				"value": "6"
			},
			{
				"name": "seipdVersion",
				"value": "2"
			}
		],
		"keyUses": [
			"sign",
			"verify",
			"encrypt",
			"decrypt"
		],
		"limits": {
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 262144,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 64
		},
		"packetGrammar": [
			"PKESKv6 algorithm 35+ SEIPDv2",
			"v6 detached signature algorithm 30"
		],
		"permissions": {
			"create": false,
			"decrypt": false,
			"verify": false
		},
		"dependencies": [],
		"conversionEdges": [],
		"vectorFiles": [],
		"dependencyReleases": [
			{
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			}
		],
		"admitted": "",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "replaces the mail KEM and signature with composites; does not make OPAQUE, WebAuthn, TLS, classical trust roots or password entropy quantum-safe",
		"attackPath": [
			"mailbox private key sits in an AMK-encrypted secret bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'mail-search-index-v1': {
		"id": "mail-search-index-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "legacy private search index leaf secret",
		"construction": "HKDF-SHA-256 over the account key password with the account id as salt and info \"thelemail-search-index-v1\", 32 bytes, stored as a product bundle entry",
		"primitives": [
			"hkdf-sha256"
		],
		"parameters": [
			{
				"name": "secretBytes",
				"value": "32"
			}
		],
		"keyUses": [
			"derive"
		],
		"limits": {
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"product bundle entry"
		],
		"permissions": {
			"create": true,
			"decrypt": true,
			"verify": false
		},
		"dependencies": [
			"product-bundle-v1"
		],
		"conversionEdges": [
			"mail-search-root-v1"
		],
		"vectorFiles": [
			"product-keys-read-v1.json"
		],
		"dependencyReleases": [
			{
				"module": "go",
				"version": "1.27.4"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "search tokens are unlinkable without the leaf secret",
		"attackPath": [
			"secret sits in a product bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'mail-search-root-v1': {
		"id": "mail-search-root-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "search root key and encrypted local search artifacts",
		"construction": "search root sealed under the product root; artifacts use HKDF-SHA-256 info \"thelemail/search-artifact/v1\" || 0x00 || SHA-256(AAD) and AES-256-GCM",
		"primitives": [
			"hkdf-sha256",
			"aes-256-gcm"
		],
		"parameters": [
			{
				"name": "rootBytes",
				"value": "32"
			}
		],
		"keyUses": [
			"derive",
			"encrypt",
			"decrypt"
		],
		"limits": {
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"search root envelope",
			"search artifact header || ciphertext"
		],
		"permissions": {
			"create": true,
			"decrypt": true,
			"verify": false
		},
		"dependencies": [
			"product-bundle-v1"
		],
		"conversionEdges": [],
		"vectorFiles": [
			"search-keys-v1.json"
		],
		"dependencyReleases": [
			{
				"module": "go",
				"version": "1.27.4"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "local search artifacts open only under the account's search root",
		"attackPath": [
			"search root sits under the product root",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'opaque-current': {
		"id": "opaque-current",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "password and recovery authentication producing the export key for AMK slots",
		"construction": "OPAQUE with ristretto255-SHA512 OPRF and 3DH AKE, Argon2id KSF (time 3, memory 64 MiB, 4 lanes, 16-byte salt, 64-byte output), identified by its config digest and server-key epoch",
		"primitives": [
			"ristretto255",
			"sha-512",
			"argon2id",
			"3dh"
		],
		"parameters": [
			{
				"name": "oprf",
				"value": "ristretto255-sha512"
			},
			{
				"name": "ksf",
				"value": "argon2id t=3 m=65536 p=4"
			},
			{
				"name": "exportKeyBytes",
				"value": "64"
			}
		],
		"keyUses": [
			"authenticate",
			"derive"
		],
		"limits": {
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"RFC 9807 registration and login messages"
		],
		"permissions": {
			"create": true,
			"decrypt": false,
			"verify": true
		},
		"dependencies": [],
		"conversionEdges": [],
		"vectorFiles": [
			"opaque.json"
		],
		"dependencyReleases": [
			{
				"module": "github.com/bytemare/opaque",
				"version": "v0.18.0"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "server never learns the password or export key; classical only, the OPRF is not quantum-safe",
		"attackPath": [
			"password guess against the stored record after server compromise is bounded by Argon2id",
			"export key unwraps the password-amk slot"
		]
	},
	'product-bundle-v1': {
		"id": "product-bundle-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "product-root-encrypted key bundles for one product",
		"construction": "HKDF-SHA-256 info \"thelemail/product-bundle/v1\" || 0x00 || SHA-256(AAD) from the product root, AES-256-GCM, AAD is the JCS envelope without ciphertext",
		"primitives": [
			"hkdf-sha256",
			"aes-256-gcm",
			"jcs"
		],
		"parameters": [
			{
				"name": "saltBytes",
				"value": "32"
			},
			{
				"name": "nonceBytes",
				"value": "12"
			}
		],
		"keyUses": [
			"wrap",
			"unwrap"
		],
		"limits": {
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 1048576,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"JCS product bundle envelope"
		],
		"permissions": {
			"create": true,
			"decrypt": true,
			"verify": false
		},
		"dependencies": [
			"secret-wrap-v2"
		],
		"conversionEdges": [],
		"vectorFiles": [
			"product-keys-v1.json"
		],
		"dependencyReleases": [
			{
				"module": "go",
				"version": "1.27.4"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "bundle opens only under its product root and exact context",
		"attackPath": [
			"product root sits in an AMK-encrypted secret bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	},
	'secret-wrap-v2': {
		"id": "secret-wrap-v2",
		"protocolVersion": 2,
		"status": "admitted",
		"purpose": "AMK wrapping slots and AMK-encrypted secret bundles",
		"construction": "HKDF-SHA-256 with a fresh 32-byte salt, info \"thelemail/secret-wrap/v2/\" || purpose || 0x00 || SHA-256(AAD), 32-byte key; AES-256-GCM with a fresh 12-byte nonce and 128-bit tag; AAD is the JCS of every wrapper field except ciphertext",
		"primitives": [
			"hkdf-sha256",
			"aes-256-gcm",
			"sha-256",
			"jcs"
		],
		"parameters": [
			{
				"name": "saltBytes",
				"value": "32"
			},
			{
				"name": "nonceBytes",
				"value": "12"
			},
			{
				"name": "tagBits",
				"value": "128"
			},
			{
				"name": "amkBytes",
				"value": "32"
			},
			{
				"name": "purposes",
				"value": "password-amk recovery-amk passkey-amk secret-bundle"
			}
		],
		"keyUses": [
			"wrap",
			"unwrap"
		],
		"limits": {
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 1048576,
			"maxRecipients": 0
		},
		"packetGrammar": [
			"slot wrapper: version purpose accountId amkEpoch revision slotId credentialId credentialGeneration credentialConfigDigest createdAuthEpoch kdf aead salt nonce ciphertext",
			"bundle wrapper: version purpose accountId amkEpoch revision bundleId kdf aead salt nonce ciphertext"
		],
		"permissions": {
			"create": true,
			"decrypt": true,
			"verify": false
		},
		"dependencies": [
			"opaque-current"
		],
		"conversionEdges": [],
		"vectorFiles": [
			"secret-wrap-v2.json"
		],
		"dependencyReleases": [
			{
				"module": "go",
				"version": "1.27.4"
			}
		],
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "a wrapper opens only under its own input key and exact context; classical 256-bit symmetric strength, bounded by the entropy of the route that produces the input key",
		"attackPath": [
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		]
	}
} as Record<ProfileId, Profile>);
