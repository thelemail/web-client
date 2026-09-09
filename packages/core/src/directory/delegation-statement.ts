export interface DelegationStatement {
	accountId: string;
	address: string;
	delegationId: string;
	issuedAt: string;
	keyAlgorithm: string;
	label: string;
	notAfter: string;
	notBefore: string;
	revokedAt: string | null;
	signerFingerprint: string;
	signingKeyFingerprint: string;
	version: number;
}

export type DelegationVerificationCode =
	| 'statement_malformed'
	| 'signing_key_mismatch'
	| 'address_mismatch'
	| 'fingerprint_mismatch'
	| 'signature_invalid'
	| 'not_sign_only';

export class DelegationVerificationError extends Error {
	readonly code: DelegationVerificationCode;

	constructor(code: DelegationVerificationCode, message: string) {
		super(message);
		this.name = 'DelegationVerificationError';
		this.code = code;
	}
}

export function canonicaliseDelegation(s: DelegationStatement): Uint8Array {
	const obj = {
		accountId: s.accountId,
		address: s.address,
		delegationId: s.delegationId,
		issuedAt: s.issuedAt,
		keyAlgorithm: s.keyAlgorithm,
		label: s.label,
		notAfter: s.notAfter,
		notBefore: s.notBefore,
		revokedAt: s.revokedAt,
		signerFingerprint: s.signerFingerprint.toLowerCase(),
		signingKeyFingerprint: s.signingKeyFingerprint.toLowerCase(),
		version: s.version
	};
	return new TextEncoder().encode(JSON.stringify(obj));
}

export function parseDelegationStatement(raw: Uint8Array): DelegationStatement {
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		throw new DelegationVerificationError('statement_malformed', 'statement is not valid JSON');
	}
	const s = parsed as Partial<DelegationStatement>;
	if (
		typeof s.accountId !== 'string' ||
		typeof s.address !== 'string' ||
		typeof s.delegationId !== 'string' ||
		typeof s.issuedAt !== 'string' ||
		typeof s.keyAlgorithm !== 'string' ||
		typeof s.label !== 'string' ||
		typeof s.notAfter !== 'string' ||
		typeof s.notBefore !== 'string' ||
		typeof s.signerFingerprint !== 'string' ||
		typeof s.signingKeyFingerprint !== 'string' ||
		typeof s.version !== 'number' ||
		(s.revokedAt !== null && typeof s.revokedAt !== 'string')
	) {
		throw new DelegationVerificationError('statement_malformed', 'statement is missing fields');
	}
	return s as DelegationStatement;
}

export function delegationCoversSignatureAt(s: DelegationStatement, at: Date): boolean {
	const t = at.getTime();
	if (t < Date.parse(s.notBefore) || t >= Date.parse(s.notAfter)) return false;
	if (s.revokedAt && t >= Date.parse(s.revokedAt)) return false;
	return true;
}
