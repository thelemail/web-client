<script lang="ts">
	import { trapFocus } from '$core/actions/trapFocus';
	import { m } from '$paraglide/messages.js';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import type { DirectoryVerificationCode } from '$core/directory/verify';
	import {
		LABEL_CURVE25519_LEGACY,
		LABEL_CURVE25519_V4,
		LABEL_CURVE25519_V6
	} from '$core/directory/keyLabel';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';

	interface Recipient {
		name: string;
		email: string;
	}

	interface Props {
		inner: DirectoryVerificationCode | 'unknown';
		recipient: Recipient;
		requestedAddress?: string;
		statementAddress?: string;
		signedKeyFingerprint?: string;
		servedKeyFingerprint?: string;
		expectedSignerFingerprint?: string;
		actualSignerFingerprint?: string;
		previousFingerprint?: string;
		currentFingerprint?: string;
		keyAlgorithm?: string;
		servedKeyAlgorithm?: string;
		statementField?: string;
		seenVersion?: number;
		servedVersion?: number;
		onEditRecipient: () => void;
		onRetry: () => void;
		onCancel: () => void;
	}

	let {
		inner,
		recipient,
		requestedAddress,
		statementAddress,
		signedKeyFingerprint,
		servedKeyFingerprint,
		expectedSignerFingerprint,
		actualSignerFingerprint,
		previousFingerprint,
		currentFingerprint,
		keyAlgorithm,
		servedKeyAlgorithm,
		statementField,
		seenVersion,
		servedVersion,
		onEditRecipient,
		onRetry,
		onCancel
	}: Props = $props();

	let tech = $state(false);
	let what = $state(false);

	const ACCEPTED_LABELS = [LABEL_CURVE25519_V6, LABEL_CURVE25519_V4, LABEL_CURVE25519_LEGACY].join(', ');

	type Row = [string, string | undefined];

	const version = (v: number | undefined) => (v === undefined ? undefined : `v${v}`);

	function plainFor(code: Props['inner']): string {
		switch (code) {
			case 'signature_invalid':
				return m.mail_dirfail_plain_signature_invalid();
			case 'signing_key_mismatch':
				return m.mail_dirfail_plain_signing_key_mismatch();
			case 'address_mismatch':
				return m.mail_dirfail_plain_address_mismatch();
			case 'fingerprint_mismatch':
				return m.mail_dirfail_plain_fingerprint_mismatch();
			case 'algorithm_mismatch':
				return m.mail_dirfail_plain_algorithm_mismatch();
			case 'version_rolled_back':
				return m.mail_dirfail_plain_version_rolled_back();
			case 'fingerprint_changed':
				return m.mail_dirfail_plain_fingerprint_changed();
			case 'key_transition_invalid':
				return m.mail_dirfail_plain_key_transition_invalid();
			case 'tlog_pending':
				return m.mail_dirfail_plain_tlog_pending();
			case 'statement_malformed':
				return m.mail_dirfail_plain_statement_malformed();
			case 'unknown':
				return m.mail_dirfail_plain_unknown();
			default:
				return m.mail_dirfail_plain_default();
		}
	}

	function rowsFor(code: Props['inner'], addr: string): Row[] {
		switch (code) {
			case 'signature_invalid':
				return [
					[m.mail_dirfail_address(), addr],
					[m.mail_dirfail_trusted_signer(), expectedSignerFingerprint]
				];
			case 'signing_key_mismatch':
				return [
					[m.mail_dirfail_expected_signer(), expectedSignerFingerprint],
					[m.mail_dirfail_statement_signed_by(), actualSignerFingerprint]
				];
			case 'address_mismatch':
				return [
					[m.mail_dirfail_you_addressed(), addr],
					[m.mail_dirfail_record_is_for(), statementAddress]
				];
			case 'fingerprint_mismatch':
				return [
					[m.mail_dirfail_directory_signed(), signedKeyFingerprint],
					[m.mail_dirfail_server_returned(), servedKeyFingerprint]
				];
			case 'algorithm_mismatch':
				return [
					[m.mail_dirfail_record_claims(), keyAlgorithm],
					[m.mail_dirfail_served_key_is(), servedKeyAlgorithm],
					[m.mail_dirfail_accepted_here(), ACCEPTED_LABELS]
				];
			case 'version_rolled_back':
				return [
					[m.mail_dirfail_verified_before(), version(seenVersion)],
					[m.mail_dirfail_server_now_serves(), version(servedVersion)]
				];
			case 'fingerprint_changed':
			case 'key_transition_invalid':
			case 'tlog_pending':
				return [
					[m.mail_dirfail_previously_pinned(), previousFingerprint],
					[m.mail_dirfail_now_serves(), currentFingerprint],
					[m.mail_dirfail_verified_before(), version(seenVersion)],
					[m.mail_dirfail_server_now_serves(), version(servedVersion)]
				];
			case 'statement_malformed':
				return [
					[m.mail_dirfail_address(), addr],
					[m.mail_dirfail_invalid_field(), statementField]
				];
			default:
				return [[m.mail_dirfail_address(), addr]];
		}
	}

	const finding = $derived.by<{ plain: string; rows: [string, string][] }>(() => {
		const addr = requestedAddress ?? recipient.email;
		const rows = [[m.mail_dirfail_error_code(), inner] as Row, ...rowsFor(inner, addr)].filter(
			(r): r is [string, string] => typeof r[1] === 'string' && r[1].length > 0
		);
		return { plain: plainFor(inner), rows };
	});

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
	}

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) onCancel();
	}
</script>

<svelte:document onkeydown={handleKey} />

<div
	class="dv-scrim"
	role="alertdialog"
	aria-modal="true"
	use:trapFocus
	aria-labelledby="dv-title"
	tabindex="-1"
	onmousedown={scrimMouseDown}
>
	<div class="dv-modal" role="presentation" onmousedown={(e) => e.stopPropagation()}>
		<div class="dv-crest">
			<span class="dv-seal"><ShieldAlert size={26} /></span>
			<span class="dv-eyebrow">{m.mail_dirfail_eyebrow()}</span>
		</div>

		<h2 class="dv-title" id="dv-title">
			{m.mail_dirfail_title()}
		</h2>
		<p class="dv-lede">
			<Rich text={m.mail_dirfail_lede({ name: recipient.name || recipient.email })} tags={{ b: bold }} />
		</p>

		<div class="dv-finding">
			<div class="dv-finding-h">{m.mail_dirfail_what_we_found()}</div>
			<p>{finding.plain}</p>
		</div>

		<div class="dv-assure">
			<Lock size={14} />
			{m.mail_dirfail_assure()}
		</div>

		<div class="dv-fold">
			<button type="button" class="dv-disclose" class:open={tech} onclick={() => (tech = !tech)}>
				<ChevronRight size={15} />{m.mail_dirfail_show_details()}
			</button>
			{#if tech}
				<div class="dv-tech">
					{#each finding.rows as [k, v], i (i)}
						<div class="dv-techrow">
							<span class="dv-tk">{k}</span>
							<span class="dv-tv">{v}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<button type="button" class="dv-what" class:open={what} onclick={() => (what = !what)}>
			{m.mail_dirfail_what_is_this()}
			{#if what}<ChevronUp size={14} />{:else}<ChevronDown size={14} />{/if}
		</button>
		{#if what}
			<div class="dv-explainer">
				<Rich text={m.mail_dirfail_explainer()} tags={{ i: italic }} />
			</div>
		{/if}

		<div class="dv-actions">
			<Button variant="primary" onclick={onEditRecipient}>
				<Pencil size={15} />{m.mail_dirfail_edit_recipient()}
			</Button>
			<Button variant="ghost" onclick={onRetry} title={m.mail_dirfail_retry_title()}>
				<RefreshCw size={15} />{m.common_retry()}
			</Button>
			<div class="dv-spacer"></div>
			<button type="button" class="linklike" onclick={onCancel}>{m.mail_dirfail_back_to_draft()}</button>
		</div>
	</div>
</div>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet italic(t: string)}<i>{t}</i>{/snippet}
