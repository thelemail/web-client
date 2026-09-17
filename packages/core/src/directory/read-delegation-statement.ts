export const READ_DELEGATION_PERMISSION = 'decrypt-forwarded';

export interface ReadDelegationStatement {
	accountId: string;
	address: string;
	encryptionKeyFingerprint: string;
	issuedAt: string;
	keyAlgorithm: string;
	notBefore: string;
	permissions: string[];
	readDelegationId: string;
	revokedAt: string | null;
	signingKeyFingerprint: string;
	version: number;
}

export type ReadDelegationVerificationCode =
	| 'statement_malformed'
	| 'signing_key_mismatch'
	| 'address_mismatch'
	| 'delegation_mismatch'
	| 'fingerprint_mismatch'
	| 'signature_invalid'
	| 'revoked'
	| 'permission_mismatch'
	| 'not_encryption_only';

export class ReadDelegationVerificationError extends Error {
	readonly code: ReadDelegationVerificationCode;

	constructor(code: ReadDelegationVerificationCode, message: string) {
		super(message);
		this.name = 'ReadDelegationVerificationError';
		this.code = code;
	}
}

export function canonicaliseReadDelegation(s: ReadDelegationStatement): Uint8Array {
	const obj = {
		accountId: s.accountId,
		address: s.address,
		encryptionKeyFingerprint: s.encryptionKeyFingerprint.toLowerCase(),
		issuedAt: s.issuedAt,
		keyAlgorithm: s.keyAlgorithm,
		notBefore: s.notBefore,
		permissions: [...s.permissions],
		readDelegationId: s.readDelegationId,
		revokedAt: s.revokedAt,
		signingKeyFingerprint: s.signingKeyFingerprint.toLowerCase(),
		version: s.version
	};
	return new TextEncoder().encode(JSON.stringify(obj));
}

export function parseReadDelegationStatement(raw: Uint8Array): ReadDelegationStatement {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		throw new ReadDelegationVerificationError('statement_malformed', 'statement is not valid JSON');
	}
	const s = parsed as Partial<ReadDelegationStatement>;
	if (
		typeof s.accountId !== 'string' ||
		typeof s.address !== 'string' ||
		typeof s.encryptionKeyFingerprint !== 'string' ||
		typeof s.issuedAt !== 'string' ||
		typeof s.keyAlgorithm !== 'string' ||
		typeof s.notBefore !== 'string' ||
		!Array.isArray(s.permissions) ||
		!s.permissions.every((p) => typeof p === 'string') ||
		typeof s.readDelegationId !== 'string' ||
		typeof s.signingKeyFingerprint !== 'string' ||
		typeof s.version !== 'number' ||
		(s.revokedAt !== null && typeof s.revokedAt !== 'string')
	) {
		throw new ReadDelegationVerificationError('statement_malformed', 'statement is missing fields');
	}
	return {
		accountId: s.accountId,
		address: s.address,
		encryptionKeyFingerprint: s.encryptionKeyFingerprint,
		issuedAt: s.issuedAt,
		keyAlgorithm: s.keyAlgorithm,
		notBefore: s.notBefore,
		permissions: s.permissions,
		readDelegationId: s.readDelegationId,
		revokedAt: s.revokedAt ?? null,
		signingKeyFingerprint: s.signingKeyFingerprint,
		version: s.version
	};
}
