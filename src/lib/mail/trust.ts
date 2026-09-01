import type { SignatureVerdict } from '$lib/keystore/protocol';
import type { DirectoryTrust, ExternalKeyState } from './senderVerify';
import type { AuthState, MessagePreviewAuth } from './preview';
import type { OfficialFacts } from './officialSender';
import { formatFingerprintHex, formatVerifiedAt } from '$lib/directory/format';

export type TrustTier =
	| 'official'
	| 'verified'
	| 'encrypted'
	| 'authenticated'
	| 'none'
	| 'attention'
	| 'failed';

export type CheckState = 'pass' | 'absent' | 'fail';

export interface TrustCheck {
	id: string;
	label: string;
	state: CheckState;
	explain: string;
	rows: TrustTechnicalRow[];
}

export interface TrustTechnicalRow {
	label: string;
	value: string;
}

export interface MessageTrust {
	tier: TrustTier;
	headline: string;
	label: string;
	checks: TrustCheck[];
	footnote?: string;
	action?: 'confirm_key_change';
	address?: string;
}

export type Channel = 'internal' | 'inbound_external' | 'outbound_external';

export interface TrustFacts {
	channel: Channel;
	senderAddress: string;
	e2e: boolean;
	signature?: SignatureVerdict;
	directory?: DirectoryTrust | null;
	externalKey?: ExternalKeyState | null;
	domainAuth?: MessagePreviewAuth;
	domainAuthState?: AuthState;
	official?: OfficialFacts;
	nowMillis: number;
}

const BLOCKING_TLOG_CODES = new Set([
	'tlog_tree_rolled_back',
	'tlog_inclusion_invalid',
	'tlog_vrf_invalid',
	'tlog_checkpoint_unverified'
]);

function tlogAttack(dir?: DirectoryTrust | null): boolean {
	const tlog = dir?.tlog;
	return tlog?.state === 'failed' && BLOCKING_TLOG_CODES.has(tlog.code);
}

const BLOCKING_DIRECTORY_CODES = new Set([
	'version_rolled_back',
	'tlog_tree_rolled_back',
	'tlog_inclusion_invalid',
	'tlog_checkpoint_unverified',
	'tlog_vrf_invalid'
]);

const FAILURE_HEADLINES: Record<string, string> = {
	signature_invalid: 'Sender identity could not be verified',
	address_mismatch: 'The directory answered for a different address',
	fingerprint_mismatch: 'The served key does not match the signed record',
	algorithm_mismatch: 'Unsupported key algorithm',
	signing_key_mismatch: 'The directory record was signed by an unknown key',
	statement_malformed: 'The directory record could not be read',
	version_rolled_back: 'The directory record went backwards',
	tlog_proof_missing: 'No transparency log proof was provided',
	tlog_proof_malformed: 'The transparency log proof could not be read',
	tlog_checkpoint_unverified: 'The transparency log checkpoint is not trusted',
	tlog_witness_policy_unmet: 'Not enough witnesses confirmed the checkpoint',
	tlog_checkpoint_stale: 'The transparency log checkpoint is out of date',
	tlog_inclusion_invalid: 'The key is not included in the transparency log',
	tlog_vrf_invalid: 'The transparency log entry does not match this address',
	tlog_tree_rolled_back: 'The transparency log went backwards'
};

function domainOf(address: string): string {
	const at = address.lastIndexOf('@');
	return at === -1 ? address : address.slice(at + 1);
}

function relativeTime(fromMillis: number, nowMillis: number): string {
	const seconds = Math.max(0, Math.round((nowMillis - fromMillis) / 1000));
	if (seconds < 60) return 'just now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.round(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}

function keyRows(dir?: DirectoryTrust | null): TrustTechnicalRow[] {
	if (!dir) return [];
	const rows: TrustTechnicalRow[] = [];
	if (dir.statement) {
		rows.push({ label: 'Sender key', value: formatFingerprintHex(dir.statement.keyFingerprint) });
		rows.push({
			label: 'Directory record',
			value: formatVerifiedAt(Date.parse(dir.statement.issuedAt), dir.statement.version)
		});
		rows.push({
			label: 'Signed by',
			value: formatFingerprintHex(dir.statement.signingKeyFingerprint)
		});
	}
	return rows;
}

function changeRows(dir?: DirectoryTrust | null): TrustTechnicalRow[] {
	if (!dir?.details) return [];
	const d = dir.details;
	const rows: TrustTechnicalRow[] = [];
	if (d.previousFingerprint) {
		rows.push({ label: 'Key you saw', value: formatFingerprintHex(d.previousFingerprint) });
	}
	if (d.currentFingerprint) {
		rows.push({ label: 'Key served now', value: formatFingerprintHex(d.currentFingerprint) });
	}
	if (d.previousVersion !== undefined) {
		rows.push({ label: 'Version you saw', value: `v${d.previousVersion}` });
	}
	if (d.currentVersion !== undefined) {
		rows.push({ label: 'Version served now', value: `v${d.currentVersion}` });
	}
	if (dir.code) rows.push({ label: 'Finding', value: dir.code });
	return rows;
}

function signatureRows(sig?: SignatureVerdict): TrustTechnicalRow[] {
	if (!sig || sig.state === 'none') return [];
	const rows: TrustTechnicalRow[] = [{ label: 'Result', value: sig.state }];
	if (sig.keyFingerprintHex) {
		rows.push({ label: 'Signing key', value: formatFingerprintHex(sig.keyFingerprintHex) });
	}
	if (sig.signedAtMillis) {
		rows.push({ label: 'Signed at', value: new Date(sig.signedAtMillis).toISOString() });
	}
	return rows;
}

function logRows(dir?: DirectoryTrust | null): TrustTechnicalRow[] {
	const tlog = dir?.tlog;
	if (!tlog) return [];
	if (tlog.state === 'verified') {
		return [
			{ label: 'Log', value: tlog.origin },
			{ label: 'Tree size', value: String(tlog.treeSize) },
			{ label: 'Leaf index', value: String(tlog.leafIndex) }
		];
	}
	if (tlog.state === 'failed') {
		const rows: TrustTechnicalRow[] = [{ label: 'Finding', value: tlog.code }];
		if (tlog.details.logOrigin) rows.push({ label: 'Log', value: tlog.details.logOrigin });
		if (tlog.details.treeSize !== undefined) {
			rows.push({ label: 'Tree size', value: String(tlog.details.treeSize) });
		}
		return rows;
	}
	return [];
}

function witnessRows(dir?: DirectoryTrust | null): TrustTechnicalRow[] {
	const tlog = dir?.tlog;
	if (!tlog) return [];
	if (tlog.state === 'verified') {
		const rows: TrustTechnicalRow[] = [
			{ label: 'Confirmed by', value: String(tlog.validWitnessCount) },
			{ label: 'Required', value: String(tlog.witnessThreshold) }
		];
		if (tlog.cosignatureTimestamp) {
			rows.push({
				label: 'Last cosigned',
				value: new Date(tlog.cosignatureTimestamp * 1000).toISOString()
			});
		}
		return rows;
	}
	if (tlog.state === 'failed' && tlog.details.validWitnessCount !== undefined) {
		return [
			{ label: 'Confirmed by', value: String(tlog.details.validWitnessCount) },
			{ label: 'Required', value: String(tlog.details.witnessThreshold ?? 0) }
		];
	}
	return [];
}

function domainRows(auth?: MessagePreviewAuth): TrustTechnicalRow[] {
	if (!auth) return [];
	const rows: TrustTechnicalRow[] = [];
	if (auth.spf) rows.push({ label: 'SPF', value: auth.spf });
	if (auth.dkim) rows.push({ label: 'DKIM', value: auth.dkim });
	if (auth.dmarc) rows.push({ label: 'DMARC', value: auth.dmarc });
	return rows;
}

function witnessesMet(facts: TrustFacts): boolean {
	const tlog = facts.directory?.tlog;
	if (!tlog || tlog.state !== 'verified') return false;
	return tlog.witnessThreshold >= 1 && tlog.validWitnessCount >= tlog.witnessThreshold;
}

function internalChecks(facts: TrustFacts): TrustCheck[] {
	const dir = facts.directory;
	const tlog = dir?.tlog;
	const sig = facts.signature?.state;
	const witnessCount =
		tlog?.state === 'verified'
			? tlog.validWitnessCount
			: tlog?.state === 'failed'
				? (tlog.details.validWitnessCount ?? 0)
				: 0;
	const witnessNeed =
		tlog?.state === 'verified'
			? tlog.witnessThreshold
			: tlog?.state === 'failed'
				? (tlog.details.witnessThreshold ?? 0)
				: 0;

	const unverifiedSender = !dir || dir.missing;
	const encryption: TrustCheck = facts.e2e
		? unverifiedSender
			? {
					id: 'e2e',
					state: 'pass',
					label: 'Stored encrypted to your key',
					explain:
						'Thelemail holds only ciphertext for this message and cannot read it at rest. Without a verified sender key, this device cannot tell whether it was already encrypted before it arrived.',
					rows: []
				}
			: {
					id: 'e2e',
					state: 'pass',
					label: 'Encrypted end to end',
					explain:
						'The message was encrypted to your key before it left the sender. Thelemail stores only the ciphertext and cannot read it.',
					rows: []
				}
		: {
				id: 'e2e',
				state: 'absent',
				label: 'Not encrypted end to end',
				explain:
					'This message arrived as ordinary mail, so it was readable by the servers that carried it.',
				rows: []
			};

	const signature: TrustCheck =
		sig === 'valid'
			? {
					id: 'signature',
					state: 'pass',
					label: 'Signature is valid',
					explain:
						'This device checked the signature on the message against the key the directory publishes for the sender, and it matched.',
					rows: signatureRows(facts.signature)
				}
			: sig === 'invalid'
				? {
						id: 'signature',
						state: 'fail',
						label: 'Signature does not match the sender key',
						explain:
							'The message carries a signature, but it does not verify against the key the directory publishes for this sender. Treat the contents as unattributed.',
						rows: signatureRows(facts.signature)
					}
				: {
						id: 'signature',
						state: 'absent',
						label: !dir || dir.missing
							? 'No signature to check'
							: 'Signature was not checked',
						explain:
							!dir || dir.missing
								? 'There is no published key for this address, so any signature on the message could not be checked against anything.'
								: 'No signature could be checked on this message, either because it carries none or because the sender key was unavailable.',
						rows: signatureRows(facts.signature)
					};

	const binding: TrustCheck =
		sig === 'valid' && dir?.ok
			? {
					id: 'binding',
					state: 'pass',
					label: 'Sender address matches the signing key',
					explain:
						'The key that signed this message is the one the directory publishes for this exact address, so the address and the key belong together.',
					rows: keyRows(dir)
				}
			: {
					id: 'binding',
					state: 'absent',
					label: 'Sender identity is not cryptographically verified',
					explain:
						!dir || dir.missing
							? 'Tying an address to a key needs a key published for that address. This one publishes none, so the sender in the header is not backed by any cryptography.'
							: 'Tying an address to a key needs both a valid signature and a verified directory record. One of the two was missing here.',
					rows: keyRows(dir)
				};

	const transparency: TrustCheck =
		tlog?.state === 'verified'
			? {
					id: 'tlog',
					state: 'pass',
					label: 'Key is published in the transparency log',
					explain:
						'The sender key appears in a public append-only log, so a key swapped in just for you would be visible to anyone watching the log.',
					rows: logRows(dir)
				}
			: tlog?.state === 'failed'
				? tlogAttack(dir)
					? {
							id: 'tlog',
							state: 'fail',
							label: 'The transparency log does not vouch for this key',
							explain:
								'The log proof did not verify against the checkpoint this device trusts. A log that cannot show this key, or that shows a different history to you than to everyone else, is what a targeted key substitution looks like.',
							rows: logRows(dir)
						}
					: {
							id: 'tlog',
							state: 'absent',
							label: 'Transparency log could not be checked right now',
							explain:
								'The proof was missing or the checkpoint was too old to use. Nothing here says the key is wrong, only that the log could not confirm it on this attempt.',
							rows: logRows(dir)
						}
				: {
						id: 'tlog',
						state: 'absent',
						label: 'Transparency log is not configured here',
						explain:
							'This client has no transparency log policy loaded, so the key was not checked against the public log.',
						rows: logRows(dir)
					};

	const witnesses: TrustCheck = witnessesMet(facts)
		? {
				id: 'witnesses',
				state: 'pass',
				label: `Checkpoint confirmed by ${witnessCount} of ${witnessNeed} independent witnesses`,
				explain:
					'Independent witnesses cosigned the log checkpoint, so the log cannot show a different history to you than it shows to everyone else.',
				rows: witnessRows(dir)
			}
		: witnessNeed > 0
			? {
					id: 'witnesses',
					state: 'absent',
					label: `Witness quorum unavailable: ${witnessCount} of ${witnessNeed} confirmations`,
					explain:
						'Independent witnesses are enrolled, but this checkpoint did not carry enough valid confirmations to meet the configured quorum. This can be a temporary witness or network outage.',
					rows: witnessRows(dir)
				}
			: {
				id: 'witnesses',
				state: 'absent',
				label: 'No independent witnesses are watching this log yet',
				explain:
					'Witnesses are third parties that cosign the log checkpoint. None are enrolled yet, so the log is trusted on its own signature alone.',
				rows: witnessRows(dir)
			};

	const continuity: TrustCheck = !dir || dir.missing
		? {
				id: 'keychange',
				state: 'absent',
				label: 'No key on record for this address',
				explain:
					'This address publishes no key in the Thelemail directory, so there is nothing to compare against and no key change to detect.',
				rows: []
			}
		: dir.ok
		? dir.firstContact
			? {
					id: 'keychange',
					state: 'absent',
					label: 'First message you have had from this sender',
					explain:
						'This device has not seen this sender before, so there is no earlier key to compare against. The key is pinned now and future messages are checked against it.',
					rows: keyRows(dir)
				}
			: {
					id: 'keychange',
					state: 'pass',
					label: 'Same key as the last message from this sender',
					explain:
						'The key matches the one this device pinned the last time you heard from this address, so nobody has stepped in since.',
					rows: keyRows(dir)
				}
		: dir?.code === 'version_rolled_back'
			? {
					id: 'keychange',
					state: 'fail',
					label: 'The directory served an older record than you already saw',
					explain:
						'A directory record can only move forward. Being handed an older version means the record was rolled back, which is what an attacker would do to reinstate a retired key.',
					rows: changeRows(dir)
				}
			: {
					id: 'keychange',
					state: 'fail',
					label: 'The key changed since you last saw this sender',
					explain:
						'The address now publishes a different key. That is normal after a reinstall or a new device, and it is also what it looks like when somebody stands in for the sender.',
					rows: changeRows(dir)
				};

	return [encryption, signature, binding, transparency, witnesses, continuity];
}

function externalAuthChecks(facts: TrustFacts): TrustCheck[] {
	const domain = domainOf(facts.senderAddress);
	const state = facts.domainAuthState;
	const rows = domainRows(facts.domainAuth);

	const auth: TrustCheck =
		state === 'pass'
			? {
					id: 'domain',
					state: 'pass',
					label: `Sent by a server allowed to speak for ${domain}`,
					explain: `The message carries a DKIM signature that lines up with ${domain}, and the domain's DMARC policy says that is how its mail should look.`,
					rows
				}
			: state === 'fail'
				? {
						id: 'domain',
						state: 'fail',
						label: `Sending server could not prove it speaks for ${domain}`,
						explain: `Domain authentication failed, so the address in the From line may not be the real sender. This is what forged mail looks like.`,
						rows
					}
				: {
						id: 'domain',
						state: 'absent',
						label: `${domain} published no way to check its mail`,
						explain: `The domain has no usable SPF, DKIM or DMARC record, so there is nothing to check the sending server against. Nothing failed here.`,
						rows
					};

	return [
		auth,
		{
			id: 'e2e',
			state: 'absent',
			label: 'Not encrypted end to end',
			explain:
				'Ordinary mail is readable by every server that carries it. It was almost certainly encrypted in transit, which protects it on the wire but not at rest on those servers.',
			rows: []
		},
		{
			id: 'identity',
			state: 'absent',
			label: 'The person behind the address is not verified',
			explain:
				'Domain authentication vouches for the domain, not the individual. Anyone with an account at this domain can send as themselves.',
			rows: []
		},
		{
			id: 'tlog',
			state: 'absent',
			label: 'No key transparency for this domain',
			explain:
				'Key transparency only covers addresses published in the Thelemail directory. There is no public log to check this sender against.',
			rows: []
		}
	];
}

function externalEncryptedChecks(facts: TrustFacts): TrustCheck[] {
	const key = facts.externalKey;
	const rows: TrustTechnicalRow[] = [];
	if (key?.fingerprint) {
		rows.push({ label: 'Key', value: formatFingerprintHex(key.fingerprint) });
	}
	if (key?.source) rows.push({ label: 'Found via', value: key.source });
	if (key?.firstSeenAtMillis) {
		rows.push({ label: 'First seen', value: new Date(key.firstSeenAtMillis).toISOString() });
	}

	const continuity: TrustCheck =
		key?.status === 'pinned'
			? {
					id: 'pinned',
					state: 'pass',
					label: 'Same key this device used before',
					explain:
						'The key matches the one pinned on this device the last time you exchanged mail with this address.',
					rows
				}
			: key?.status === 'changed'
				? {
						id: 'pinned',
						state: 'fail',
						label: 'The key changed since this device last used it',
						explain:
							'A different key is now published for this address. Confirm it with the sender over another channel before trusting it.',
						rows
					}
				: {
						id: 'pinned',
						state: 'absent',
						label: 'First time this device has used this key',
						explain:
							'There is no earlier key to compare against. The key is pinned now, and a later change will be flagged.',
						rows
					};

	return [
		{
			id: 'e2e',
			state: 'pass',
			label: 'Encrypted end to end',
			explain:
				'The message was encrypted to a key held by this recipient, so the servers that carried it only ever saw ciphertext.',
			rows: []
		},
		continuity,
		{
			id: 'tlog',
			state: 'absent',
			label: 'Key is not covered by Thelemail transparency',
			explain:
				'This key came from outside the Thelemail directory, so it is not published in the transparency log and cannot be monitored there.',
			rows: []
		},
		{
			id: 'witnesses',
			state: 'absent',
			label: 'No independent witnesses can confirm this key',
			explain:
				'Witnesses cosign the Thelemail log. A key discovered outside that log has nothing for them to confirm.',
			rows: []
		}
	];
}

const GREEN_TIERS = new Set<TrustTier>(['official', 'verified', 'encrypted', 'authenticated']);

function clamp(trust: MessageTrust): MessageTrust {
	if (!GREEN_TIERS.has(trust.tier)) return trust;
	if (!trust.checks.some((c) => c.state === 'fail')) return trust;
	return { ...trust, tier: 'failed', label: 'Verification failed' };
}

export function deriveTrust(facts: TrustFacts): MessageTrust {
	return clamp(derive(facts));
}

function officialChecks(facts: TrustFacts): TrustCheck[] {
	const o = facts.official;
	const fp = facts.signature?.keyFingerprintHex;
	return [
		{
			id: 'official',
			state: o?.signedByOfficial ? 'pass' : 'fail',
			label: o?.signedByOfficial ? 'Signed by Thelemail' : 'Not signed by Thelemail',
			explain:
				'This message carries a signature from the Thelemail key built into this app. Nobody else can produce it, including the Thelemail servers.',
			rows: fp ? [{ label: 'Signing key', value: formatFingerprintHex(fp) }] : []
		},
		{
			id: 'binding',
			state: o?.headerBound ? 'pass' : 'fail',
			label: o?.headerBound
				? 'The signature covers the sender and subject shown'
				: 'The signature does not cover the sender shown',
			explain:
				'The signature covers the sender address and subject you see above, not only the text, so neither can be swapped after signing.',
			rows: []
		},
		{
			id: 'channel',
			state: o?.channelOk ? 'pass' : 'fail',
			label: o?.channelOk
				? 'Delivered inside Thelemail'
				: 'This arrived from outside Thelemail',
			explain:
				'Thelemail sends its own notices straight into your mailbox. Anything claiming to be from Thelemail that arrived over ordinary mail is not from Thelemail.',
			rows: []
		},
		{
			id: 'e2e',
			state: facts.e2e ? 'pass' : 'absent',
			label: 'Encrypted to your key before it was stored',
			explain: 'Thelemail holds only ciphertext for this message and cannot read it at rest.',
			rows: []
		},
		{
			id: 'tlog',
			state: facts.directory?.tlog?.state === 'verified' ? 'pass' : 'absent',
			label: 'Published in the transparency log',
			explain:
				'The same key is published in the public Thelemail log, so its history can be audited independently of this app.',
			rows: logRows(facts.directory)
		}
	];
}

function derive(facts: TrustFacts): MessageTrust {
	const base = { address: facts.senderAddress };
	const dir = facts.directory;

	if (facts.official?.claimed) {
		const o = facts.official;
		if (!o.signedByOfficial || !o.headerBound || !o.channelOk) {
			return {
				...base,
				tier: 'failed',
				label: 'Not from Thelemail',
				headline: 'This message is not from Thelemail',
				checks: officialChecks(facts),
				footnote:
					'It uses a Thelemail address in the From line, but it is not signed by the Thelemail key this app carries. Do not act on it.'
			};
		}
		return {
			...base,
			tier: 'official',
			label: 'Official',
			headline: 'Sent by Thelemail',
			checks: officialChecks(facts)
		};
	}

	if (tlogAttack(dir)) {
		return {
			...base,
			tier: 'failed',
			label: 'Verification failed',
			headline: 'The transparency log does not vouch for this key',
			checks: internalChecks(facts)
		};
	}

	if (facts.signature?.state === 'invalid') {
		return {
			...base,
			tier: 'failed',
			label: 'Signature invalid',
			headline: 'The signature on this message is not valid',
			checks: internalChecks(facts),
			footnote: 'This message was not signed by the key the directory publishes for the sender.'
		};
	}

	if (dir && !dir.ok && dir.code) {
		const changedUpwards =
			dir.code === 'fingerprint_changed' &&
			(dir.details?.currentVersion ?? 0) > (dir.details?.previousVersion ?? 0);
		if (changedUpwards) {
			return {
				...base,
				tier: 'attention',
				label: 'Key changed',
				headline: "The sender's key has changed since you last saw it",
				checks: internalChecks(facts),
				footnote: dir.details?.previousVerifiedAtMillis
					? `Last verified ${relativeTime(dir.details.previousVerifiedAtMillis, facts.nowMillis)}`
					: undefined,
				action: 'confirm_key_change'
			};
		}
		const blocking = BLOCKING_DIRECTORY_CODES.has(dir.code);
		return {
			...base,
			tier: 'failed',
			label: blocking ? 'Verification failed' : 'Could not verify',
			headline: FAILURE_HEADLINES[dir.code] ?? 'Sender identity could not be verified',
			checks: internalChecks(facts)
		};
	}

	if (facts.domainAuthState === 'fail') {
		return {
			...base,
			tier: 'failed',
			label: 'Authentication failed',
			headline: 'This message failed domain authentication',
			checks: externalAuthChecks(facts),
			footnote: `The sending server could not prove it speaks for ${domainOf(facts.senderAddress)}.`
		};
	}

	if (facts.externalKey?.status === 'changed') {
		return {
			...base,
			tier: 'attention',
			label: 'Key changed',
			headline: "This sender's encryption key has changed",
			checks: externalEncryptedChecks(facts),
			footnote: facts.externalKey.fingerprint
				? `New key · ${formatFingerprintHex(facts.externalKey.fingerprint)}`
				: undefined,
			action: 'confirm_key_change'
		};
	}

	const fullPolicy = Boolean(
		facts.e2e &&
			facts.signature?.state === 'valid' &&
			dir?.ok &&
			dir.tlog.state === 'verified' &&
			witnessesMet(facts)
	);

	if (fullPolicy) {
		return {
			...base,
			tier: 'verified',
			label: 'Encrypted and verified',
			headline: 'Encrypted and verified',
			checks: internalChecks(facts),
			footnote: dir?.verifiedAtMillis
				? `Verified on this device · ${relativeTime(dir.verifiedAtMillis, facts.nowMillis)}`
				: undefined
		};
	}

	if (facts.e2e && facts.channel === 'internal' && (!dir || dir.missing)) {
		return {
			...base,
			tier: 'none',
			label: 'Unverified sender',
			headline: 'Encrypted, but the sender is not verified',
			checks: internalChecks(facts),
			footnote: dir?.missing
				? 'This address publishes no key, so nothing here proves who sent it.'
				: 'The directory could not be reached, so the sender was not checked.'
		};
	}

	if (facts.e2e) {
		const external = facts.channel !== 'internal';
		return {
			...base,
			tier: 'encrypted',
			label: 'End-to-end encrypted',
			headline: 'End-to-end encrypted',
			checks: external ? externalEncryptedChecks(facts) : internalChecks(facts),
			footnote: external
				? facts.externalKey?.fingerprint
					? `Key remembered · ${formatFingerprintHex(facts.externalKey.fingerprint)}`
					: 'Key remembered on this device'
				: dir?.verifiedAtMillis
					? `Verified on this device · ${relativeTime(dir.verifiedAtMillis, facts.nowMillis)}`
					: undefined
		};
	}

	if (facts.domainAuthState === 'pass') {
		return {
			...base,
			tier: 'authenticated',
			label: 'Sender domain authenticated',
			headline: 'Sender domain authenticated',
			checks: externalAuthChecks(facts),
			footnote: 'Protected in transit where supported'
		};
	}

	return {
		...base,
		tier: 'none',
		label: 'Not authenticated',
		headline: 'Sender domain not authenticated',
		checks: externalAuthChecks(facts),
		footnote: 'Nothing failed. The sending domain simply published no way to check.'
	};
}
