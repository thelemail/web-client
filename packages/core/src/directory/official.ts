import { PUBLIC_OFFICIAL_SENDER_POLICY } from '$env/static/public';

interface OfficialSenderPolicy {
	addresses: string[];
	keys: string[];
	fingerprints: string[];
	displayName: string;
}

function parsePolicy(raw: string | undefined): OfficialSenderPolicy {
	if (!raw) {
		throw new Error(
			'PUBLIC_OFFICIAL_SENDER_POLICY is not set. ' +
				'Set it to the contents of web-client/trust-roots/official-sender.json.'
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY is not valid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY must be a JSON object');
	}
	const p = parsed as Record<string, unknown>;
	if (!Array.isArray(p.addresses) || p.addresses.length === 0) {
		throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY: addresses must be a non-empty array');
	}
	for (const addr of p.addresses) {
		if (typeof addr !== 'string' || addr !== addr.toLowerCase() || !addr.includes('@')) {
			throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY: addresses must be lowercase email addresses');
		}
	}
	if (!Array.isArray(p.keys) || p.keys.length === 0) {
		throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY: keys must be a non-empty array');
	}
	for (const key of p.keys) {
		if (typeof key !== 'string' || key.length === 0) {
			throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY: keys must be armored public keys');
		}
	}
	if (!Array.isArray(p.fingerprints) || p.fingerprints.length !== (p.keys as string[]).length) {
		throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY: one fingerprint is required per key');
	}
	for (const fp of p.fingerprints) {
		if (typeof fp !== 'string' || !/^[0-9a-f]{32,}$/.test(fp)) {
			throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY: fingerprints must be lowercase hex');
		}
	}
	if (typeof p.displayName !== 'string' || p.displayName.length === 0) {
		throw new Error('PUBLIC_OFFICIAL_SENDER_POLICY: displayName is missing or empty');
	}
	return {
		addresses: p.addresses as string[],
		keys: p.keys as string[],
		fingerprints: p.fingerprints as string[],
		displayName: p.displayName
	};
}

const policy = parsePolicy(PUBLIC_OFFICIAL_SENDER_POLICY);

export const OFFICIAL_ADDRESSES: ReadonlySet<string> = new Set(policy.addresses);
export const OFFICIAL_KEYS_ARMORED: readonly string[] = policy.keys;
export const OFFICIAL_DISPLAY_NAME = policy.displayName;

export const OFFICIAL_FINGERPRINTS: ReadonlySet<string> = new Set(policy.fingerprints);

export function isOfficialAddress(address: string): boolean {
	return OFFICIAL_ADDRESSES.has(address.trim().toLowerCase());
}

export function isOfficialFingerprint(fingerprintHex: string | undefined): boolean {
	if (!fingerprintHex) return false;
	return OFFICIAL_FINGERPRINTS.has(fingerprintHex.trim().toLowerCase());
}
