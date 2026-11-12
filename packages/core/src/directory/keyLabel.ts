import * as openpgp from 'openpgp';

export const LABEL_CURVE25519_V6 = 'openpgp-curve25519-v6';
export const LABEL_CURVE25519_V4 = 'openpgp-curve25519-v4';
export const LABEL_CURVE25519_LEGACY = 'openpgp-curve25519-legacy';

export const MISLABELLED_V4_CUTOFF = Date.parse('2026-09-21T00:00:00Z');

const { publicKey: algo, keyFlags } = openpgp.enums;

const ALGORITHM_NAMES: Partial<Record<number, string>> = {
	[algo.rsaEncryptSign]: 'openpgp-rsa',
	[algo.eddsaLegacy]: 'openpgp-eddsa',
	[algo.ed25519]: 'openpgp-ed25519',
	[algo.ecdsa]: 'openpgp-ecdsa',
	[algo.ecdh]: 'openpgp-ecdh',
	[algo.x25519]: 'openpgp-x25519'
};

type KeyPacket = openpgp.Key['keyPacket'] | openpgp.Subkey['keyPacket'];

function primaryLabel(packet: KeyPacket): string {
	const name = ALGORITHM_NAMES[packet.algorithm] ?? `openpgp-algo-${packet.algorithm}`;
	return packet.version === 6 ? `${name}-v6` : name;
}

const ENCRYPTING_ALGORITHMS = new Set<number>([algo.rsaEncryptSign, algo.ecdh, algo.x25519]);

function latestBinding(sub: openpgp.Subkey): openpgp.SignaturePacket | undefined {
	let latest: openpgp.SignaturePacket | undefined;
	for (const sig of sub.bindingSignatures) {
		if (!latest || (sig.created?.getTime() ?? 0) >= (latest.created?.getTime() ?? 0)) {
			latest = sig;
		}
	}
	return latest;
}

function encryptionSubkey(key: openpgp.Key): KeyPacket | null {
	for (const sub of key.getSubkeys()) {
		if (!ENCRYPTING_ALGORITHMS.has(sub.keyPacket.algorithm)) continue;
		const flags = latestBinding(sub)?.keyFlags;
		if (!flags || flags.length === 0 || flags[0] & (keyFlags.encryptCommunication | keyFlags.encryptStorage)) {
			return sub.keyPacket;
		}
	}
	return null;
}

function isLegacyCurve25519(packet: KeyPacket, algorithm: number): boolean {
	if (packet.algorithm !== algorithm) return false;
	const { curve } = packet.getAlgorithmInfo();
	return curve === openpgp.enums.curve.ed25519Legacy || curve === openpgp.enums.curve.curve25519Legacy;
}

export function keyLabel(key: openpgp.Key): string {
	const primary = key.keyPacket;
	const enc = encryptionSubkey(key);
	if (!enc) return primaryLabel(primary);
	if (primary.algorithm === algo.ed25519 && enc.algorithm === algo.x25519) {
		if (primary.version === 6) return LABEL_CURVE25519_V6;
		if (primary.version === 4) return LABEL_CURVE25519_V4;
	}
	if (
		primary.version === 4 &&
		isLegacyCurve25519(primary, algo.eddsaLegacy) &&
		isLegacyCurve25519(enc, algo.ecdh)
	) {
		return LABEL_CURVE25519_LEGACY;
	}
	return primaryLabel(primary);
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function parseRFC3339(value: string): number {
	return RFC3339.test(value) ? Date.parse(value) : Number.NaN;
}

export function labelMatchesKey(label: string, key: openpgp.Key, issuedAt: string): boolean {
	const actual = keyLabel(key);
	if (label === actual) return true;
	return (
		label === LABEL_CURVE25519_V6 &&
		(actual === LABEL_CURVE25519_V4 || actual === LABEL_CURVE25519_LEGACY) &&
		parseRFC3339(issuedAt) < MISLABELLED_V4_CUTOFF
	);
}
