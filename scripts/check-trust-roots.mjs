import { readFileSync } from 'node:fs';
import { readKey } from 'openpgp';

const KEY_PATH = 'trust-roots/directory-signing-key.asc';
const POLICY_PATH = 'trust-roots/tlog-policy.json';
const OFFICIAL_PATH = 'trust-roots/official-sender.json';
const ADDRESS = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MODES = new Set(['monitor', 'enforce']);

const failures = [];

function read(path) {
	const text = readFileSync(path, 'utf8');
	if (text.trim().length === 0) throw new Error(`${path} is empty`);
	return text;
}

try {
	const key = await readKey({ armoredKey: read(KEY_PATH) });
	if (key.isPrivate()) failures.push(`${KEY_PATH} is a private key and must never be committed`);
	const expiry = await key.getExpirationTime();
	if (expiry !== Infinity && (expiry === null || expiry.getTime() <= Date.now())) {
		failures.push(`${KEY_PATH} is expired or unusable`);
	}
	console.log(`directory signer: ${key.getFingerprint()} (${key.getUserIDs().join(', ')})`);
} catch (err) {
	failures.push(`${KEY_PATH}: ${err.message}`);
}

try {
	const policy = JSON.parse(read(POLICY_PATH));
	for (const field of ['origin', 'logVerifierKey', 'vrfPublicKey', 'mode']) {
		if (typeof policy[field] !== 'string' || policy[field].length === 0) {
			failures.push(`${POLICY_PATH}: ${field} is missing or empty`);
		}
	}
	if (!MODES.has(policy.mode)) {
		failures.push(`${POLICY_PATH}: mode must be one of ${[...MODES].join(', ')}`);
	}
	if (!Array.isArray(policy.witnessVerifierKeys)) {
		failures.push(`${POLICY_PATH}: witnessVerifierKeys must be an array`);
	}
	if (!Number.isInteger(policy.witnessThreshold) || policy.witnessThreshold < 0) {
		failures.push(`${POLICY_PATH}: witnessThreshold must be a non-negative integer`);
	}
	if (policy.witnessThreshold > (policy.witnessVerifierKeys ?? []).length) {
		failures.push(`${POLICY_PATH}: witnessThreshold exceeds the number of witness keys`);
	}
	if (!Number.isInteger(policy.maxCosignatureAgeSeconds) || policy.maxCosignatureAgeSeconds <= 0) {
		failures.push(`${POLICY_PATH}: maxCosignatureAgeSeconds must be a positive integer`);
	}
	console.log(`transparency log: ${policy.origin} (${policy.mode})`);
} catch (err) {
	failures.push(`${POLICY_PATH}: ${err.message}`);
}

try {
	const official = JSON.parse(read(OFFICIAL_PATH));
	if (!Array.isArray(official.addresses) || official.addresses.length === 0) {
		failures.push(`${OFFICIAL_PATH}: addresses must be a non-empty array`);
	} else {
		for (const addr of official.addresses) {
			if (typeof addr !== 'string' || addr !== addr.toLowerCase() || !ADDRESS.test(addr)) {
				failures.push(`${OFFICIAL_PATH}: ${JSON.stringify(addr)} is not a lowercase email address`);
			}
		}
	}
	if (typeof official.displayName !== 'string' || official.displayName.length === 0) {
		failures.push(`${OFFICIAL_PATH}: displayName is missing or empty`);
	}
	if (!Array.isArray(official.fingerprints) || official.fingerprints.length === 0) {
		failures.push(`${OFFICIAL_PATH}: fingerprints must be a non-empty array`);
	}
	if (!Array.isArray(official.keys) || official.keys.length === 0) {
		failures.push(`${OFFICIAL_PATH}: keys must be a non-empty array`);
	} else {
		const stated = new Set(official.fingerprints ?? []);
		if (stated.size !== official.keys.length) {
			failures.push(`${OFFICIAL_PATH}: one fingerprint is required per key`);
		}
		for (const armoredKey of official.keys) {
			try {
				const key = await readKey({ armoredKey });
				if (key.isPrivate()) {
					failures.push(`${OFFICIAL_PATH} carries a private key and must never be committed`);
				}
				const expiry = await key.getExpirationTime();
				if (expiry !== Infinity && (expiry === null || expiry.getTime() <= Date.now())) {
					failures.push(`${OFFICIAL_PATH}: key ${key.getFingerprint()} is expired or unusable`);
				}
				const fp = key.getFingerprint().toLowerCase();
				if (!stated.has(fp)) {
					failures.push(`${OFFICIAL_PATH}: key ${fp} is not listed in fingerprints`);
				}
				console.log(`official sender: ${fp} (${key.getUserIDs().join(', ')})`);
			} catch (err) {
				failures.push(`${OFFICIAL_PATH}: ${err.message}`);
			}
		}
	}
} catch (err) {
	failures.push(`${OFFICIAL_PATH}: ${err.message}`);
}

if (failures.length > 0) {
	console.error('Trust roots are not usable:');
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
