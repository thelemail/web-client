import { readFileSync } from 'node:fs';
import { readKey } from 'openpgp';

const KEY_PATH = 'trust-roots/directory-signing-key.asc';
const POLICY_PATH = 'trust-roots/tlog-policy.json';
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

if (failures.length > 0) {
	console.error('Trust roots are not usable:');
	for (const f of failures) console.error(`  ${f}`);
	process.exit(1);
}
