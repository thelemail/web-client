import type { KeyUse, ProfileId, ProfileStatus } from './profile-ids';

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

export const PROFILES: Readonly<Record<ProfileId, Profile>> = Object.freeze({
	'account-authority-ed25519-v1': Object.freeze({
		"id": "account-authority-ed25519-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "account authority key that signs account heads and delegations",
		"construction": "OpenPGP v6 Ed25519 primary key with no subkeys, signing flag only",
		"primitives": Object.freeze([
			"ed25519",
			"sha-256"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "keyVersion",
				"value": "6"
			})
		]),
		"keyUses": Object.freeze([
			"sign",
			"verify"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"v6 public key: primary and self-signature, no user IDs, no subkeys"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": false,
			"verify": true
		}),
		"dependencies": Object.freeze([
			"secret-wrap-v2"
		]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([
			"product-keys-v1.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "classical authenticity of account heads",
		"attackPath": Object.freeze([
			"authority secret key sits in an AMK-encrypted secret bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'calendar-identity-v1': Object.freeze({
		"id": "calendar-identity-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "calendar product identity",
		"construction": "OpenPGP v6 Ed25519 primary signing key with exactly one X25519 encryption subkey",
		"primitives": Object.freeze([
			"ed25519",
			"x25519"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "keyVersion",
				"value": "6"
			})
		]),
		"keyUses": Object.freeze([
			"sign",
			"verify",
			"encrypt",
			"decrypt"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"v6 public key: primary, self-signature, one encryption subkey"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": true,
			"verify": true
		}),
		"dependencies": Object.freeze([
			"product-bundle-v1"
		]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([
			"product-keys-v1.json",
			"calendar-signatures-v1.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "classical confidentiality and authenticity of calendar data",
		"attackPath": Object.freeze([
			"calendar private key sits in a product bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'device-preview-current': Object.freeze({
		"id": "device-preview-current",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "short-lived per-device push notification previews",
		"construction": "x25519-hkdf-sha256-aes256gcm: ephemeral X25519 to the device preview key, HKDF-SHA-256 info \"thelemail-preview-v1\", AES-256-GCM with a 12-byte nonce, AAD accountId 0x1f messageId",
		"primitives": Object.freeze([
			"x25519",
			"hkdf-sha256",
			"aes-256-gcm"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "publicKeyBytes",
				"value": "32"
			}),
			Object.freeze({
				"name": "nonceBytes",
				"value": "12"
			})
		]),
		"keyUses": Object.freeze([
			"encrypt",
			"decrypt"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 32,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 1
		}),
		"packetGrammar": Object.freeze([
			"ephemeralPublicKey || nonce || ciphertext"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": true,
			"verify": false
		}),
		"dependencies": Object.freeze([]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "go",
				"version": "1.27.4"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "classical confidentiality of a short preview to one device; cannot support a whole-product post-quantum claim",
		"attackPath": Object.freeze([
			"device preview private key stays in the device keystore"
		])
	}),
	'ingress-binding-v1': Object.freeze({
		"id": "ingress-binding-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "attests that ingress associated a stored object with an account",
		"construction": "raw Ed25519 signature over the storage-binding transcript with a dedicated Vault transit key; public keys distributed by scoped TUF policy",
		"primitives": Object.freeze([
			"ed25519"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "signatureBytes",
				"value": "64"
			})
		]),
		"keyUses": Object.freeze([
			"sign",
			"verify"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 32,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 64,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"64-byte Ed25519 signature"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": false,
			"verify": true
		}),
		"dependencies": Object.freeze([]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "go",
				"version": "1.27.4"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "authorized ingress association only, not external sender authorship",
		"attackPath": Object.freeze([
			"Vault transit key compromise forges bindings until its separate rotation"
		])
	}),
	'legacy-import-amk-wrap-v1': Object.freeze({
		"id": "legacy-import-amk-wrap-v1",
		"protocolVersion": 1,
		"status": "legacy-import",
		"purpose": "historical binary AMK wrappers awaiting secret-wrap-v2 slots",
		"construction": "HKDF-SHA-256 with empty salt and info \"thelemail/amk-wrap/v1\" or \"thelemail/amk-wrap/recovery/v1\", AES-256-GCM with the info as AAD, encoded 0x01 || nonce || ciphertext",
		"primitives": Object.freeze([
			"hkdf-sha256",
			"aes-256-gcm"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "wrapperBytes",
				"value": "61"
			})
		]),
		"keyUses": Object.freeze([
			"unwrap",
			"convert"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 61,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"0x01 || nonce12 || ciphertext32 || tag16"
		]),
		"permissions": Object.freeze({
			"create": false,
			"decrypt": true,
			"verify": false
		}),
		"dependencies": Object.freeze([
			"opaque-current"
		]),
		"conversionEdges": Object.freeze([
			"secret-wrap-v2"
		]),
		"vectorFiles": Object.freeze([]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "go",
				"version": "1.27.4"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "read and convert only; the wrapper binds no account, epoch or slot context",
		"attackPath": Object.freeze([
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot"
		])
	}),
	'legacy-import-openpgp-curve25519-legacy': Object.freeze({
		"id": "legacy-import-openpgp-curve25519-legacy",
		"protocolVersion": 1,
		"status": "legacy-import",
		"purpose": "historical v4 keys from the pre-RFC 9580 Curve25519 encodings",
		"construction": "OpenPGP v4 EdDSALegacy (algorithm 22) primary key with ECDH (algorithm 18) Curve25519 subkey, v1 SEIPD",
		"primitives": Object.freeze([
			"ed25519",
			"x25519",
			"aes-256",
			"sha-256"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "keyVersion",
				"value": "4"
			}),
			Object.freeze({
				"name": "signatureAlgorithm",
				"value": "22"
			}),
			Object.freeze({
				"name": "encryptionAlgorithm",
				"value": "18"
			})
		]),
		"keyUses": Object.freeze([
			"verify",
			"decrypt",
			"convert"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 262144,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"PKESKv3+ SEIPDv1",
			"v4 signature"
		]),
		"permissions": Object.freeze({
			"create": false,
			"decrypt": true,
			"verify": true
		}),
		"dependencies": Object.freeze([]),
		"conversionEdges": Object.freeze([
			"mail-classic-v1"
		]),
		"vectorFiles": Object.freeze([
			"key-labels.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "read, verify and convert only; v1 SEIPD prefixes are unauthenticated until the whole message verifies",
		"attackPath": Object.freeze([
			"legacy private key sits in the account vault",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'legacy-import-openpgp-curve25519-v4': Object.freeze({
		"id": "legacy-import-openpgp-curve25519-v4",
		"protocolVersion": 1,
		"status": "legacy-import",
		"purpose": "historical v4 keys with RFC 9580 Ed25519 and X25519 algorithms",
		"construction": "OpenPGP v4 Ed25519 (algorithm 27) primary key with X25519 (algorithm 25) subkey",
		"primitives": Object.freeze([
			"ed25519",
			"x25519",
			"aes-256",
			"sha-256"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "keyVersion",
				"value": "4"
			})
		]),
		"keyUses": Object.freeze([
			"verify",
			"decrypt",
			"convert"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 262144,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"PKESKv3+ SEIPDv1",
			"v4 signature"
		]),
		"permissions": Object.freeze({
			"create": false,
			"decrypt": true,
			"verify": true
		}),
		"dependencies": Object.freeze([]),
		"conversionEdges": Object.freeze([
			"mail-classic-v1"
		]),
		"vectorFiles": Object.freeze([
			"key-labels.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "read, verify and convert only; v1 SEIPD prefixes are unauthenticated until the whole message verifies",
		"attackPath": Object.freeze([
			"legacy private key sits in the account vault",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'legacy-import-srp-v1': Object.freeze({
		"id": "legacy-import-srp-v1",
		"protocolVersion": 1,
		"status": "legacy-import",
		"purpose": "historical SRP password and recovery verifiers awaiting OPAQUE re-registration",
		"construction": "ProtonMail SRP-6a with bcrypt-hashed password",
		"primitives": Object.freeze([
			"srp-6a",
			"bcrypt"
		]),
		"parameters": Object.freeze([]),
		"keyUses": Object.freeze([
			"authenticate",
			"convert"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"SRP verifier and salt"
		]),
		"permissions": Object.freeze({
			"create": false,
			"decrypt": false,
			"verify": true
		}),
		"dependencies": Object.freeze([]),
		"conversionEdges": Object.freeze([
			"opaque-current"
		]),
		"vectorFiles": Object.freeze([]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "github.com/ProtonMail/go-srp",
				"version": "v0.0.7"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "read and convert only; never a new registration",
		"attackPath": Object.freeze([
			"stored verifier is an offline password-guessing oracle until revoked"
		])
	}),
	'mail-classic-v1': Object.freeze({
		"id": "mail-classic-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "internal mailbox, alias and shared-scope OpenPGP keys and payloads",
		"construction": "OpenPGP v6 Ed25519 primary signing key, X25519 encryption subkey, v6 PKESK, v2 SEIPD with AES-256 and OCB, 64 KiB AEAD chunks, no compression, SHA-256 signatures unless the operation requires a standard-defined alternative",
		"primitives": Object.freeze([
			"ed25519",
			"x25519",
			"aes-256",
			"ocb",
			"sha-256"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "keyVersion",
				"value": "6"
			}),
			Object.freeze({
				"name": "seipdVersion",
				"value": "2"
			}),
			Object.freeze({
				"name": "aeadChunkBytes",
				"value": "65536"
			}),
			Object.freeze({
				"name": "compression",
				"value": "none"
			})
		]),
		"keyUses": Object.freeze([
			"sign",
			"verify",
			"encrypt",
			"decrypt"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 262144,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 64
		}),
		"packetGrammar": Object.freeze([
			"PKESKv6+ SEIPDv2",
			"v6 detached signature",
			"v6 public key: primary, self-signatures, one encryption subkey"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": true,
			"verify": true
		}),
		"dependencies": Object.freeze([]),
		"conversionEdges": Object.freeze([
			"mail-pq-v1"
		]),
		"vectorFiles": Object.freeze([
			"key-labels.json",
			"attachments.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "classical confidentiality and authenticity of mail payloads against an adversary without a quantum computer",
		"attackPath": Object.freeze([
			"mailbox private key sits in an AMK-encrypted secret bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'mail-import-dedup-v1': Object.freeze({
		"id": "mail-import-dedup-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "stable import deduplication secret kept independent of the AMK",
		"construction": "32-byte secret stored as a product bundle entry; accounts that predate it carry SHA-256(\"thelemail/import-dedup-key/v1\" || 0x00 || key password)",
		"primitives": Object.freeze([
			"sha-256"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "secretBytes",
				"value": "32"
			})
		]),
		"keyUses": Object.freeze([
			"derive"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"product bundle entry"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": true,
			"verify": false
		}),
		"dependencies": Object.freeze([
			"product-bundle-v1"
		]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([
			"product-keys-read-v1.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "go",
				"version": "1.27.4"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "import identity survives AMK rotation",
		"attackPath": Object.freeze([
			"secret sits in a product bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'mail-pq-v1': Object.freeze({
		"id": "mail-pq-v1",
		"protocolVersion": 1,
		"status": "recognized",
		"purpose": "next internal mailbox profile; recognized for parsing only until admitted",
		"construction": "OpenPGP v6, RFC 9980 ML-DSA-65+Ed25519 primary signature algorithm 30, ML-KEM-768+X25519 encryption algorithm 35, v6 PKESK, v2 SEIPD with AES-256 and OCB, hash handling exactly as RFC 9980 mandates, no classical-only alternative PKESK",
		"primitives": Object.freeze([
			"ml-dsa-65",
			"ed25519",
			"ml-kem-768",
			"x25519",
			"aes-256",
			"ocb"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "signatureAlgorithm",
				"value": "30"
			}),
			Object.freeze({
				"name": "encryptionAlgorithm",
				"value": "35"
			}),
			Object.freeze({
				"name": "keyVersion",
				"value": "6"
			}),
			Object.freeze({
				"name": "seipdVersion",
				"value": "2"
			})
		]),
		"keyUses": Object.freeze([
			"sign",
			"verify",
			"encrypt",
			"decrypt"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 262144,
			"maxPrivateKeyBytes": 262144,
			"maxSignatureBytes": 65536,
			"maxPayloadBytes": 0,
			"maxRecipients": 64
		}),
		"packetGrammar": Object.freeze([
			"PKESKv6 algorithm 35+ SEIPDv2",
			"v6 detached signature algorithm 30"
		]),
		"permissions": Object.freeze({
			"create": false,
			"decrypt": false,
			"verify": false
		}),
		"dependencies": Object.freeze([]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "github.com/thelemail/go-crypto",
				"version": "v0.2.0"
			})
		]),
		"admitted": "",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "replaces the mail KEM and signature with composites; does not make OPAQUE, WebAuthn, TLS, classical trust roots or password entropy quantum-safe",
		"attackPath": Object.freeze([
			"mailbox private key sits in an AMK-encrypted secret bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'mail-search-index-v1': Object.freeze({
		"id": "mail-search-index-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "legacy private search index leaf secret",
		"construction": "HKDF-SHA-256 over the account key password with the account id as salt and info \"thelemail-search-index-v1\", 32 bytes, stored as a product bundle entry",
		"primitives": Object.freeze([
			"hkdf-sha256"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "secretBytes",
				"value": "32"
			})
		]),
		"keyUses": Object.freeze([
			"derive"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"product bundle entry"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": true,
			"verify": false
		}),
		"dependencies": Object.freeze([
			"product-bundle-v1"
		]),
		"conversionEdges": Object.freeze([
			"mail-search-root-v1"
		]),
		"vectorFiles": Object.freeze([
			"product-keys-read-v1.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "go",
				"version": "1.27.4"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "search tokens are unlinkable without the leaf secret",
		"attackPath": Object.freeze([
			"secret sits in a product bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'mail-search-root-v1': Object.freeze({
		"id": "mail-search-root-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "search root key and encrypted local search artifacts",
		"construction": "search root sealed under the product root; artifacts use HKDF-SHA-256 info \"thelemail/search-artifact/v1\" || 0x00 || SHA-256(AAD) and AES-256-GCM",
		"primitives": Object.freeze([
			"hkdf-sha256",
			"aes-256-gcm"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "rootBytes",
				"value": "32"
			})
		]),
		"keyUses": Object.freeze([
			"derive",
			"encrypt",
			"decrypt"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"search root envelope",
			"search artifact header || ciphertext"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": true,
			"verify": false
		}),
		"dependencies": Object.freeze([
			"product-bundle-v1"
		]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([
			"search-keys-v1.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "go",
				"version": "1.27.4"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "local search artifacts open only under the account's search root",
		"attackPath": Object.freeze([
			"search root sits under the product root",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'opaque-current': Object.freeze({
		"id": "opaque-current",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "password and recovery authentication producing the export key for AMK slots",
		"construction": "OPAQUE with ristretto255-SHA512 OPRF and 3DH AKE, Argon2id KSF (time 3, memory 64 MiB, 4 lanes, 16-byte salt, 64-byte output), identified by its config digest and server-key epoch",
		"primitives": Object.freeze([
			"ristretto255",
			"sha-512",
			"argon2id",
			"3dh"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "oprf",
				"value": "ristretto255-sha512"
			}),
			Object.freeze({
				"name": "ksf",
				"value": "argon2id t=3 m=65536 p=4"
			}),
			Object.freeze({
				"name": "exportKeyBytes",
				"value": "64"
			})
		]),
		"keyUses": Object.freeze([
			"authenticate",
			"derive"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 0,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"RFC 9807 registration and login messages"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": false,
			"verify": true
		}),
		"dependencies": Object.freeze([]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([
			"opaque.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "github.com/bytemare/opaque",
				"version": "v0.18.0"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "server never learns the password or export key; classical only, the OPRF is not quantum-safe",
		"attackPath": Object.freeze([
			"password guess against the stored record after server compromise is bounded by Argon2id",
			"export key unwraps the password-amk slot"
		])
	}),
	'product-bundle-v1': Object.freeze({
		"id": "product-bundle-v1",
		"protocolVersion": 1,
		"status": "admitted",
		"purpose": "product-root-encrypted key bundles for one product",
		"construction": "HKDF-SHA-256 info \"thelemail/product-bundle/v1\" || 0x00 || SHA-256(AAD) from the product root, AES-256-GCM, AAD is the JCS envelope without ciphertext",
		"primitives": Object.freeze([
			"hkdf-sha256",
			"aes-256-gcm",
			"jcs"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "saltBytes",
				"value": "32"
			}),
			Object.freeze({
				"name": "nonceBytes",
				"value": "12"
			})
		]),
		"keyUses": Object.freeze([
			"wrap",
			"unwrap"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 1048576,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"JCS product bundle envelope"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": true,
			"verify": false
		}),
		"dependencies": Object.freeze([
			"secret-wrap-v2"
		]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([
			"product-keys-v1.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "go",
				"version": "1.27.4"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "bundle opens only under its product root and exact context",
		"attackPath": Object.freeze([
			"product root sits in an AMK-encrypted secret bundle",
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	}),
	'secret-wrap-v2': Object.freeze({
		"id": "secret-wrap-v2",
		"protocolVersion": 2,
		"status": "admitted",
		"purpose": "AMK wrapping slots and AMK-encrypted secret bundles",
		"construction": "HKDF-SHA-256 with a fresh 32-byte salt, info \"thelemail/secret-wrap/v2/\" || purpose || 0x00 || SHA-256(AAD), 32-byte key; AES-256-GCM with a fresh 12-byte nonce and 128-bit tag; AAD is the JCS of every wrapper field except ciphertext",
		"primitives": Object.freeze([
			"hkdf-sha256",
			"aes-256-gcm",
			"sha-256",
			"jcs"
		]),
		"parameters": Object.freeze([
			Object.freeze({
				"name": "saltBytes",
				"value": "32"
			}),
			Object.freeze({
				"name": "nonceBytes",
				"value": "12"
			}),
			Object.freeze({
				"name": "tagBits",
				"value": "128"
			}),
			Object.freeze({
				"name": "amkBytes",
				"value": "32"
			}),
			Object.freeze({
				"name": "purposes",
				"value": "password-amk recovery-amk passkey-amk secret-bundle"
			})
		]),
		"keyUses": Object.freeze([
			"wrap",
			"unwrap"
		]),
		"limits": Object.freeze({
			"maxPublicKeyBytes": 0,
			"maxPrivateKeyBytes": 0,
			"maxSignatureBytes": 0,
			"maxPayloadBytes": 1048576,
			"maxRecipients": 0
		}),
		"packetGrammar": Object.freeze([
			"slot wrapper: version purpose accountId amkEpoch revision slotId credentialId credentialGeneration credentialConfigDigest createdAuthEpoch kdf aead salt nonce ciphertext",
			"bundle wrapper: version purpose accountId amkEpoch revision bundleId kdf aead salt nonce ciphertext"
		]),
		"permissions": Object.freeze({
			"create": true,
			"decrypt": true,
			"verify": false
		}),
		"dependencies": Object.freeze([
			"opaque-current"
		]),
		"conversionEdges": Object.freeze([]),
		"vectorFiles": Object.freeze([
			"secret-wrap-v2.json"
		]),
		"dependencyReleases": Object.freeze([
			Object.freeze({
				"module": "go",
				"version": "1.27.4"
			})
		]),
		"admitted": "2026-11-27",
		"newWriteCutoff": "",
		"activeReadCutoff": "",
		"incidentStatus": "none",
		"securityClaim": "a wrapper opens only under its own input key and exact context; classical 256-bit symmetric strength, bounded by the entropy of the route that produces the input key",
		"attackPath": Object.freeze([
			"OPAQUE export key unwraps the password-amk slot",
			"recovery export key unwraps the recovery-amk slot",
			"tested WebAuthn PRF output unwraps the passkey-amk slot",
			"approved local device unlock key unwraps the device keystore wrapper"
		])
	})
} as Record<ProfileId, Profile>);
