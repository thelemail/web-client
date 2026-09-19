import type { SignatureVerdict } from '$core/keystore/protocol';
import type { DirectoryTrust, ExternalKeyState } from './senderVerify';
import type { AuthState, MessagePreviewAuth } from './preview';
import type { OfficialFacts } from './officialSender';
import type { DelegatedSignerTrust } from './senderVerify';
import { formatFingerprintHex, formatVerifiedAt } from '$core/directory/format';
import type { SignatureStatus } from '$core/api/types';
import { m } from '$paraglide/messages.js';

export type TrustTier =
	| 'official'
	| 'verified'
	| 'encrypted'
	| 'delegated'
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
	delegatedSigner?: DelegatedSignerTrust | null;
	serverSignature?: ServerSignature;
	nowMillis: number;
}

export interface ServerSignature {
	status: SignatureStatus;
	keyFingerprintHex?: string;
}

const BLOCKING_TLOG_CODES = new Set([
	'tlog_tree_rolled_back',
	'tlog_checkpoint_conflict',
	'tlog_consistency_invalid',
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
	'tlog_checkpoint_conflict',
	'tlog_consistency_invalid',
	'tlog_inclusion_invalid',
	'tlog_checkpoint_unverified',
	'tlog_vrf_invalid'
]);

const FAILURE_HEADLINES: Record<string, () => string> = {
	signature_invalid: () => m.trust_failure_signature_invalid(),
	address_mismatch: () => m.trust_failure_address_mismatch(),
	fingerprint_mismatch: () => m.trust_failure_fingerprint_mismatch(),
	algorithm_mismatch: () => m.trust_failure_algorithm_mismatch(),
	signing_key_mismatch: () => m.trust_failure_signing_key_mismatch(),
	statement_malformed: () => m.trust_failure_statement_malformed(),
	version_rolled_back: () => m.trust_failure_version_rolled_back(),
	tlog_proof_missing: () => m.trust_failure_tlog_proof_missing(),
	tlog_proof_malformed: () => m.trust_failure_tlog_proof_malformed(),
	tlog_checkpoint_unverified: () => m.trust_failure_tlog_checkpoint_unverified(),
	tlog_witness_policy_unmet: () => m.trust_failure_tlog_witness_policy_unmet(),
	tlog_policy_invalid: () => m.trust_failure_tlog_policy_invalid(),
	tlog_checkpoint_stale: () => m.trust_failure_tlog_checkpoint_stale(),
	tlog_inclusion_invalid: () => m.trust_failure_tlog_inclusion_invalid(),
	tlog_vrf_invalid: () => m.trust_failure_tlog_vrf_invalid(),
	tlog_tree_rolled_back: () => m.trust_failure_tlog_tree_rolled_back(),
	tlog_checkpoint_conflict: () => m.trust_failure_tlog_checkpoint_conflict(),
	tlog_consistency_invalid: () => m.trust_failure_tlog_consistency_invalid(),
	tlog_consistency_unavailable: () => m.trust_failure_tlog_consistency_unavailable()
};

function domainOf(address: string): string {
	const at = address.lastIndexOf('@');
	return at === -1 ? address : address.slice(at + 1);
}

function relativeTime(fromMillis: number, nowMillis: number): string {
	const seconds = Math.max(0, Math.round((nowMillis - fromMillis) / 1000));
	if (seconds < 60) return m.trust_just_now();
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return m.trust_minutes_ago({ count: minutes });
	const hours = Math.round(minutes / 60);
	if (hours < 24) return m.trust_hours_ago({ count: hours });
	const days = Math.round(hours / 24);
	return m.trust_days_ago({ count: days });
}

function keyRows(dir?: DirectoryTrust | null): TrustTechnicalRow[] {
	if (!dir) return [];
	const rows: TrustTechnicalRow[] = [];
	if (dir.statement) {
		rows.push({ label: m.trust_row_sender_key(), value: formatFingerprintHex(dir.statement.keyFingerprint) });
		rows.push({
			label: m.trust_row_directory_record(),
			value: formatVerifiedAt(Date.parse(dir.statement.issuedAt), dir.statement.version)
		});
		rows.push({
			label: m.trust_row_signed_by(),
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
		rows.push({ label: m.trust_row_key_you_saw(), value: formatFingerprintHex(d.previousFingerprint) });
	}
	if (d.currentFingerprint) {
		rows.push({ label: m.trust_row_key_served_now(), value: formatFingerprintHex(d.currentFingerprint) });
	}
	if (d.previousVersion !== undefined) {
		rows.push({ label: m.trust_row_version_you_saw(), value: `v${d.previousVersion}` });
	}
	if (d.currentVersion !== undefined) {
		rows.push({ label: m.trust_row_version_served_now(), value: `v${d.currentVersion}` });
	}
	if (dir.code) rows.push({ label: m.trust_row_finding(), value: dir.code });
	return rows;
}

function signatureRows(sig?: SignatureVerdict): TrustTechnicalRow[] {
	if (!sig || sig.state === 'none') return [];
	const rows: TrustTechnicalRow[] = [{ label: m.trust_row_result(), value: sig.state }];
	if (sig.keyFingerprintHex) {
		rows.push({ label: m.trust_row_signing_key(), value: formatFingerprintHex(sig.keyFingerprintHex) });
	}
	if (sig.signedAtMillis) {
		rows.push({ label: m.trust_row_signed_at(), value: new Date(sig.signedAtMillis).toISOString() });
	}
	return rows;
}

function logRows(dir?: DirectoryTrust | null): TrustTechnicalRow[] {
	const tlog = dir?.tlog;
	if (!tlog) return [];
	if (tlog.state === 'verified') {
		return [
			{ label: m.trust_row_log(), value: tlog.origin },
			{ label: m.trust_row_tree_size(), value: String(tlog.treeSize) },
			{ label: m.trust_row_leaf_index(), value: String(tlog.leafIndex) }
		];
	}
	if (tlog.state === 'failed') {
		const rows: TrustTechnicalRow[] = [{ label: m.trust_row_finding(), value: tlog.code }];
		if (tlog.details.logOrigin) rows.push({ label: m.trust_row_log(), value: tlog.details.logOrigin });
		if (tlog.details.treeSize !== undefined) {
			rows.push({ label: m.trust_row_tree_size(), value: String(tlog.details.treeSize) });
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
			{ label: m.trust_row_confirmed_by(), value: String(tlog.validWitnessCount) },
			{ label: m.trust_row_required(), value: String(tlog.witnessThreshold) }
		];
		if (tlog.cosignatureTimestamp) {
			rows.push({
				label: m.trust_row_last_cosigned(),
				value: new Date(tlog.cosignatureTimestamp * 1000).toISOString()
			});
		}
		return rows;
	}
	if (tlog.state === 'failed' && tlog.details.validWitnessCount !== undefined) {
		return [
			{ label: m.trust_row_confirmed_by(), value: String(tlog.details.validWitnessCount) },
			{ label: m.trust_row_required(), value: String(tlog.details.witnessThreshold ?? 0) }
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
					label: m.trust_stored_encrypted_to_your_key(),
					explain:
						m.trust_explain_thelemail_holds_only_ciphertext_for_this(),
					rows: []
				}
			: {
					id: 'e2e',
					state: 'pass',
					label: m.trust_encrypted_end_to_end(),
					explain:
						m.trust_explain_the_message_was_encrypted_to_your(),
					rows: []
				}
		: {
				id: 'e2e',
				state: 'absent',
				label: m.trust_not_encrypted_end_to_end(),
				explain:
					m.trust_explain_this_message_arrived_as_ordinary_mail(),
				rows: []
			};

	const signature: TrustCheck =
		sig === 'valid'
			? {
					id: 'signature',
					state: 'pass',
					label: m.trust_signature_is_valid(),
					explain:
						m.trust_explain_this_device_checked_the_signature_on(),
					rows: signatureRows(facts.signature)
				}
			: sig === 'invalid'
				? {
						id: 'signature',
						state: 'fail',
						label: m.trust_signature_does_not_match_the_sender_key(),
						explain:
							m.trust_explain_the_message_carries_a_signature_but(),
						rows: signatureRows(facts.signature)
					}
				: {
						id: 'signature',
						state: 'absent',
						label: !dir || dir.missing
							? m.trust_no_signature_to_check()
							: m.trust_signature_was_not_checked(),
						explain:
							!dir || dir.missing
								? m.trust_explain_there_is_no_published_key_for()
								: m.trust_explain_no_signature_could_be_checked_on(),
						rows: signatureRows(facts.signature)
					};

	const binding: TrustCheck =
		sig === 'valid' && dir?.ok
			? {
					id: 'binding',
					state: 'pass',
					label: m.trust_sender_address_matches_the_signing_key(),
					explain:
						m.trust_explain_the_key_that_signed_this_message(),
					rows: keyRows(dir)
				}
			: {
					id: 'binding',
					state: 'absent',
					label: m.trust_sender_identity_is_not_cryptographically_verified(),
					explain:
						!dir || dir.missing
							? m.trust_explain_binding_no_published_key()
							: m.trust_explain_binding_missing_part(),
					rows: keyRows(dir)
				};

	const transparency: TrustCheck =
		tlog?.state === 'verified'
			? {
					id: 'tlog',
					state: 'pass',
					label: m.trust_key_is_published_in_the_transparency_log(),
					explain:
						m.trust_explain_the_sender_key_appears_in_a(),
					rows: logRows(dir)
				}
			: tlog?.state === 'failed'
				? tlogAttack(dir)
					? {
							id: 'tlog',
							state: 'fail',
							label: m.trust_the_transparency_log_does_not_vouch_for(),
							explain:
								m.trust_explain_the_log_proof_did_not_verify(),
							rows: logRows(dir)
						}
					: {
							id: 'tlog',
							state: 'absent',
							label: m.trust_transparency_log_could_not_be_checked_right(),
							explain:
								m.trust_explain_the_proof_was_missing_or_the(),
							rows: logRows(dir)
						}
				: {
						id: 'tlog',
						state: 'absent',
						label: m.trust_transparency_log_is_not_configured_here(),
						explain:
							m.trust_explain_this_client_has_no_transparency_log(),
						rows: logRows(dir)
					};

	const witnesses: TrustCheck = witnessesMet(facts)
		? {
				id: 'witnesses',
				state: 'pass',
				label: m.trust_witnesses_confirmed({ count: witnessCount, need: witnessNeed }),
				explain:
					m.trust_explain_independent_witnesses_cosigned_the_log_checkpoint(),
				rows: witnessRows(dir)
			}
		: witnessNeed > 0
			? {
					id: 'witnesses',
					state: 'absent',
					label: m.trust_witness_quorum_unavailable({ count: witnessCount, need: witnessNeed }),
					explain:
						m.trust_explain_independent_witnesses_are_enrolled_but_this(),
					rows: witnessRows(dir)
				}
			: {
				id: 'witnesses',
				state: 'absent',
				label: m.trust_no_independent_witnesses_are_watching_this_log(),
				explain:
					m.trust_explain_witnesses_are_third_parties_that_cosign(),
				rows: witnessRows(dir)
			};

	const continuity: TrustCheck = !dir || dir.missing
		? {
				id: 'keychange',
				state: 'absent',
				label: m.trust_no_key_on_record_for_this_address(),
				explain:
					m.trust_explain_this_address_publishes_no_key_in(),
				rows: []
			}
		: dir.ok
		? dir.firstContact
			? {
					id: 'keychange',
					state: 'absent',
					label: m.trust_first_message_you_have_had_from_this(),
					explain:
						m.trust_explain_this_device_has_not_seen_this(),
					rows: keyRows(dir)
				}
			: {
					id: 'keychange',
					state: 'pass',
					label: m.trust_same_key_as_the_last_message_from(),
					explain:
						m.trust_explain_the_key_matches_the_one_this(),
					rows: keyRows(dir)
				}
		: dir?.code === 'version_rolled_back'
			? {
					id: 'keychange',
					state: 'fail',
					label: m.trust_the_directory_served_an_older_record_than(),
					explain:
						m.trust_explain_a_directory_record_can_only_move(),
					rows: changeRows(dir)
				}
			: {
					id: 'keychange',
					state: 'fail',
					label: m.trust_the_key_changed_since_you_last_saw(),
					explain:
						m.trust_explain_the_address_now_publishes_a_different(),
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
					label: m.trust_domain_pass({ domain }),
					explain: m.trust_explain_domain_pass({ domain }),
					rows
				}
			: state === 'fail'
				? {
						id: 'domain',
						state: 'fail',
						label: m.trust_domain_fail({ domain }),
						explain: m.trust_explain_domain_authentication_failed_so_the_address(),
						rows
					}
				: {
						id: 'domain',
						state: 'absent',
						label: m.trust_domain_absent({ domain }),
						explain: m.trust_explain_the_domain_has_no_usable_spf(),
						rows
					};

	const signed = facts.serverSignature?.status === 'verified';

	return [
		auth,
		...(facts.serverSignature ? [serverSignatureCheck(facts.serverSignature)] : []),
		{
			id: 'e2e',
			state: 'absent',
			label: m.trust_not_encrypted_end_to_end(),
			explain:
				m.trust_explain_ordinary_mail_is_readable_by_every(),
			rows: []
		},
		{
			id: 'identity',
			state: 'absent',
			label: m.trust_the_person_behind_the_address_is_not(),
			explain: signed
				? m.trust_explain_the_signature_ties_this_message_to()
				: m.trust_explain_domain_authentication_vouches_for_the_domain(),
			rows: []
		},
		{
			id: 'tlog',
			state: 'absent',
			label: m.trust_no_key_transparency_for_this_domain(),
			explain:
				m.trust_explain_key_transparency_only_covers_addresses_published(),
			rows: []
		}
	];
}

function serverSignatureCheck(sig: ServerSignature): TrustCheck {
	const rows: TrustTechnicalRow[] = sig.keyFingerprintHex
		? [{ label: m.trust_row_signing_key(), value: formatFingerprintHex(sig.keyFingerprintHex) }]
		: [];
	switch (sig.status) {
		case 'verified':
			return {
				id: 'signature',
				state: 'pass',
				label: m.trust_signed_with_the_key_published_for_this(),
				explain:
					m.trust_explain_thelemail_checked_the_openpgp_signature_when(),
				rows
			};
		case 'unverified':
			return {
				id: 'signature',
				state: 'fail',
				label: m.trust_the_signature_does_not_match_the_senders(),
				explain:
					m.trust_explain_the_message_carries_a_signature_from(),
				rows
			};
		case 'unknown_key':
			return {
				id: 'signature',
				state: 'absent',
				label: m.trust_signed_with_a_key_thelemail_could_not(),
				explain:
					m.trust_explain_the_message_is_signed_but_not(),
				rows
			};
		default:
			return {
				id: 'signature',
				state: 'absent',
				label: m.trust_not_signed_by_the_sender(),
				explain: m.trust_explain_the_message_carries_no_openpgp_signature(),
				rows: []
			};
	}
}

function externalEncryptedChecks(facts: TrustFacts): TrustCheck[] {
	const key = facts.externalKey;
	const rows: TrustTechnicalRow[] = [];
	if (key?.fingerprint) {
		rows.push({ label: m.trust_row_key(), value: formatFingerprintHex(key.fingerprint) });
	}
	if (key?.source) rows.push({ label: m.trust_row_found_via(), value: key.source });
	if (key?.firstSeenAtMillis) {
		rows.push({ label: m.trust_row_first_seen(), value: new Date(key.firstSeenAtMillis).toISOString() });
	}

	const continuity: TrustCheck =
		key?.status === 'pinned'
			? {
					id: 'pinned',
					state: 'pass',
					label: m.trust_same_key_this_device_used_before(),
					explain:
						m.trust_explain_the_key_matches_the_one_pinned(),
					rows
				}
			: key?.status === 'changed'
				? {
						id: 'pinned',
						state: 'fail',
						label: m.trust_the_key_changed_since_this_device_last(),
						explain:
							m.trust_explain_a_different_key_is_now_published(),
						rows
					}
				: {
						id: 'pinned',
						state: 'absent',
						label: m.trust_first_time_this_device_has_used_this(),
						explain:
							m.trust_explain_there_is_no_earlier_key_to(),
						rows
					};

	return [
		{
			id: 'e2e',
			state: 'pass',
			label: m.trust_encrypted_end_to_end(),
			explain:
				m.trust_explain_the_message_was_encrypted_to_a(),
			rows: []
		},
		continuity,
		{
			id: 'tlog',
			state: 'absent',
			label: m.trust_key_is_not_covered_by_thelemail_transparency(),
			explain:
				m.trust_explain_this_key_came_from_outside_the(),
			rows: []
		},
		{
			id: 'witnesses',
			state: 'absent',
			label: m.trust_no_independent_witnesses_can_confirm_this_key(),
			explain:
				m.trust_explain_witnesses_cosign_the_thelemail_log_a(),
			rows: []
		}
	];
}

const GREEN_TIERS = new Set<TrustTier>([
	'official',
	'verified',
	'encrypted',
	'delegated',
	'authenticated'
]);

function clamp(trust: MessageTrust): MessageTrust {
	if (!GREEN_TIERS.has(trust.tier)) return trust;
	if (!trust.checks.some((c) => c.state === 'fail')) return trust;
	return { ...trust, tier: 'failed', label: m.trust_verification_failed() };
}

export function deriveTrust(facts: TrustFacts): MessageTrust {
	return clamp(derive(facts));
}

function delegatedChecks(facts: TrustFacts): TrustCheck[] {
	const signer = facts.delegatedSigner;
	return [
		{
			id: 'delegation',
			state: signer ? 'pass' : 'fail',
			label: signer
				? m.trust_signer_authorized({ signer: signer.label })
				: m.trust_no_authorization_found_for_this_signer(),
			explain:
				m.trust_explain_the_address_owner_published_a_signed(),
			rows: signer ? [{ label: m.trust_row_service(), value: signer.label }] : []
		},
		{
			id: 'delegation-scope',
			state: 'pass',
			label: m.trust_the_service_cannot_read_mail_for_this(),
			explain:
				m.trust_explain_a_delegated_key_can_only_sign(),
			rows: []
		},
		...externalAuthChecks(facts)
	];
}

function officialChecks(facts: TrustFacts): TrustCheck[] {
	const o = facts.official;
	const fp = facts.signature?.keyFingerprintHex;
	return [
		{
			id: 'official',
			state: o?.signedByOfficial ? 'pass' : 'fail',
			label: o?.signedByOfficial ? m.trust_signed_by_thelemail() : m.trust_not_signed_by_thelemail(),
			explain:
				m.trust_explain_this_message_carries_a_signature_from(),
			rows: fp ? [{ label: m.trust_row_signing_key(), value: formatFingerprintHex(fp) }] : []
		},
		{
			id: 'binding',
			state: o?.headerBound ? 'pass' : 'fail',
			label: o?.headerBound
				? m.trust_the_signature_covers_the_sender_and_subject()
				: m.trust_the_signature_does_not_cover_the_sender(),
			explain:
				m.trust_explain_the_signature_covers_the_sender_address(),
			rows: []
		},
		{
			id: 'channel',
			state: o?.channelOk ? 'pass' : 'fail',
			label: o?.channelOk
				? m.trust_delivered_inside_thelemail()
				: m.trust_this_arrived_from_outside_thelemail(),
			explain:
				m.trust_explain_thelemail_sends_its_own_notices_straight(),
			rows: []
		},
		{
			id: 'e2e',
			state: facts.e2e ? 'pass' : 'absent',
			label: m.trust_encrypted_to_your_key_before_it_was(),
			explain: m.trust_explain_official_ciphertext_at_rest(),
			rows: []
		},
		{
			id: 'tlog',
			state: facts.directory?.tlog?.state === 'verified' ? 'pass' : 'absent',
			label: m.trust_published_in_the_transparency_log(),
			explain:
				m.trust_explain_the_same_key_is_published_in(),
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
				label: m.trust_not_from_thelemail(),
				headline: m.trust_this_message_is_not_from_thelemail(),
				checks: officialChecks(facts),
				footnote:
					m.trust_explain_it_uses_a_thelemail_address_in()
			};
		}
		return {
			...base,
			tier: 'official',
			label: m.trust_official(),
			headline: m.trust_sent_by_thelemail(),
			checks: officialChecks(facts)
		};
	}

	if (tlogAttack(dir)) {
		return {
			...base,
			tier: 'failed',
			label: m.trust_verification_failed(),
			headline: m.trust_the_transparency_log_does_not_vouch_for(),
			checks: internalChecks(facts)
		};
	}

	if (facts.signature?.state === 'invalid') {
		return {
			...base,
			tier: 'failed',
			label: m.trust_signature_invalid(),
			headline: m.trust_the_signature_on_this_message_is_not(),
			checks: internalChecks(facts),
			footnote: m.trust_explain_this_message_was_not_signed_by()
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
				label: m.trust_key_changed(),
				headline: m.trust_the_senders_key_has_changed_since_you(),
				checks: internalChecks(facts),
				footnote: dir.details?.previousVerifiedAtMillis
					? m.trust_last_verified({ when: relativeTime(dir.details.previousVerifiedAtMillis, facts.nowMillis) })
					: undefined,
				action: 'confirm_key_change'
			};
		}
		const blocking = BLOCKING_DIRECTORY_CODES.has(dir.code);
		return {
			...base,
			tier: 'failed',
			label: blocking ? m.trust_verification_failed() : m.trust_could_not_verify(),
			headline: FAILURE_HEADLINES[dir.code]?.() ?? m.trust_failure_signature_invalid(),
			checks: internalChecks(facts)
		};
	}

	if (facts.domainAuthState === 'fail') {
		return {
			...base,
			tier: 'failed',
			label: m.trust_authentication_failed(),
			headline: m.trust_this_message_failed_domain_authentication(),
			checks: externalAuthChecks(facts),
			footnote: m.trust_footnote_domain_fail({ domain: domainOf(facts.senderAddress) })
		};
	}

	if (facts.serverSignature?.status === 'unverified') {
		return {
			...base,
			tier: 'failed',
			label: m.trust_signature_invalid(),
			headline: m.trust_the_signature_on_this_message_is_not(),
			checks: externalAuthChecks(facts),
			footnote: m.trust_explain_the_message_was_changed_after_it()
		};
	}

	if (facts.externalKey?.status === 'changed') {
		return {
			...base,
			tier: 'attention',
			label: m.trust_key_changed(),
			headline: m.trust_this_senders_encryption_key_has_changed(),
			checks: externalEncryptedChecks(facts),
			footnote: facts.externalKey.fingerprint
				? m.trust_new_key({ fingerprint: formatFingerprintHex(facts.externalKey.fingerprint) })
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
			label: m.trust_encrypted_and_verified(),
			headline: m.trust_encrypted_and_verified(),
			checks: internalChecks(facts),
			footnote: dir?.verifiedAtMillis
				? m.trust_verified_on_device({ when: relativeTime(dir.verifiedAtMillis, facts.nowMillis) })
				: undefined
		};
	}

	if (facts.e2e && facts.channel === 'internal' && (!dir || dir.missing)) {
		return {
			...base,
			tier: 'none',
			label: m.trust_unverified_sender(),
			headline: m.trust_encrypted_but_the_sender_is_not_verified(),
			checks: internalChecks(facts),
			footnote: dir?.missing
				? m.trust_explain_this_address_publishes_no_key_so()
				: m.trust_explain_the_directory_could_not_be_reached()
		};
	}

	if (facts.e2e) {
		const external = facts.channel !== 'internal';
		return {
			...base,
			tier: 'encrypted',
			label: m.trust_end_to_end_encrypted(),
			headline: m.trust_end_to_end_encrypted(),
			checks: external ? externalEncryptedChecks(facts) : internalChecks(facts),
			footnote: external
				? facts.externalKey?.fingerprint
					? m.trust_key_remembered({ fingerprint: formatFingerprintHex(facts.externalKey.fingerprint) })
					: m.trust_key_remembered_on_this_device()
				: dir?.verifiedAtMillis
					? m.trust_verified_on_device({ when: relativeTime(dir.verifiedAtMillis, facts.nowMillis) })
					: undefined
		};
	}

	if (facts.delegatedSigner) {
		return {
			...base,
			tier: 'delegated',
			label: m.trust_signed_by_an_authorized_service(),
			headline: m.trust_signed_by_signer({ signer: facts.delegatedSigner.label }),
			checks: delegatedChecks(facts),
			footnote: m.trust_footnote_delegated({ domain: domainOf(facts.senderAddress), address: facts.senderAddress })
		};
	}

	if (facts.serverSignature?.status === 'verified') {
		return {
			...base,
			tier: 'authenticated',
			label: m.trust_signed_by_the_sender(),
			headline: m.trust_signed_by_the_sender(),
			checks: externalAuthChecks(facts),
			footnote: m.trust_the_signature_proves_the_key_not_the()
		};
	}

	if (facts.domainAuthState === 'pass') {
		return {
			...base,
			tier: 'authenticated',
			label: m.trust_sender_domain_authenticated(),
			headline: m.trust_sender_domain_authenticated(),
			checks: externalAuthChecks(facts),
			footnote: m.trust_protected_in_transit_where_supported()
		};
	}

	return {
		...base,
		tier: 'none',
		label: m.trust_not_authenticated(),
		headline: m.trust_sender_domain_not_authenticated(),
		checks: externalAuthChecks(facts),
		footnote: m.trust_explain_nothing_failed_the_sending_domain_simply()
	};
}
