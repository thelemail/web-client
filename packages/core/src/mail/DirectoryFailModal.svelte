<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import type { DirectoryVerificationCode } from '$core/directory/verify';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';

	interface Recipient {
		name: string;
		email: string;
	}

	interface Props {
		inner: DirectoryVerificationCode;
		recipient: Recipient;
		requestedAddress?: string;
		statementAddress?: string;
		signedKeyFingerprint?: string;
		servedKeyFingerprint?: string;
		expectedSignerFingerprint?: string;
		actualSignerFingerprint?: string;
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
		seenVersion,
		servedVersion,
		onEditRecipient,
		onRetry,
		onCancel
	}: Props = $props();

	let tech = $state(false);
	let what = $state(false);

	const FP = {
		expectedSigner: 'D41E 7F09 2B6A C835 11E0 · 9A7C 6F2D 4B18 0C53 A9E2',
		actualSigner: '6B22 0CF4 8E19 77A3 D5B0 · 1F4E 9C28 33A1 7E60 B8D9',
		signed: 'A93C 1E07 5F2B 88D4 6A1F · 0C73 E912 4B58 9D20 7AE6',
		served: 'F70B 4A29 D183 6C95 22E1 · 8B40 3F7C 19A5 0D6E C214'
	};

	type Row = [string, string];

	const finding = $derived.by<{ plain: string; rows: Row[] }>(() => {
		const addr = requestedAddress ?? recipient.email;
		switch (inner) {
			case 'signature_invalid':
				return {
					plain: m.mail_dirfail_plain_signature_invalid(),
					rows: [
						[m.mail_dirfail_error_code(), 'signature_invalid'],
						[m.mail_dirfail_address(), addr],
						[m.mail_dirfail_trusted_signer(), expectedSignerFingerprint ?? FP.expectedSigner]
					]
				};
			case 'signing_key_mismatch':
				return {
					plain: m.mail_dirfail_plain_signing_key_mismatch(),
					rows: [
						[m.mail_dirfail_error_code(), 'signing_key_mismatch'],
						[m.mail_dirfail_expected_signer(), expectedSignerFingerprint ?? FP.expectedSigner],
						[m.mail_dirfail_statement_signed_by(), actualSignerFingerprint ?? FP.actualSigner]
					]
				};
			case 'address_mismatch':
				return {
					plain: m.mail_dirfail_plain_address_mismatch(),
					rows: [
						[m.mail_dirfail_error_code(), 'address_mismatch'],
						[m.mail_dirfail_you_addressed(), addr],
						[m.mail_dirfail_record_is_for(), statementAddress ?? m.mail_dirfail_different_address()]
					]
				};
			case 'fingerprint_mismatch':
				return {
					plain: m.mail_dirfail_plain_fingerprint_mismatch(),
					rows: [
						[m.mail_dirfail_error_code(), 'fingerprint_mismatch'],
						[m.mail_dirfail_directory_signed(), signedKeyFingerprint ?? FP.signed],
						[m.mail_dirfail_server_returned(), servedKeyFingerprint ?? FP.served]
					]
				};
			case 'algorithm_mismatch':
				return {
					plain: m.mail_dirfail_plain_algorithm_mismatch(),
					rows: [
						[m.mail_dirfail_error_code(), 'algorithm_mismatch'],
						[m.mail_dirfail_record_claims(), 'ecdh-x448'],
						[m.mail_dirfail_accepted_here(), 'ed25519, rsa ≥ 3072']
					]
				};
			case 'version_rolled_back':
				return {
					plain: m.mail_dirfail_plain_version_rolled_back(),
					rows: [
						[m.mail_dirfail_error_code(), 'version_rolled_back'],
						[m.mail_dirfail_verified_before(), seenVersion !== undefined ? `v${seenVersion}` : 'v7'],
						[m.mail_dirfail_server_now_serves(), servedVersion !== undefined ? `v${servedVersion}` : 'v5']
					]
				};
			case 'fingerprint_changed':
				return {
					plain: m.mail_dirfail_plain_fingerprint_changed(),
					rows: [
						[m.mail_dirfail_error_code(), 'fingerprint_changed'],
						[m.mail_dirfail_previously_pinned(), signedKeyFingerprint ?? FP.signed],
						[m.mail_dirfail_now_serves(), servedKeyFingerprint ?? FP.served]
					]
				};
			case 'statement_malformed':
				return {
					plain: m.mail_dirfail_plain_statement_malformed(),
					rows: [
						[m.mail_dirfail_error_code(), 'statement_malformed'],
						[m.mail_dirfail_missing_fields(), 'signingKeyFingerprint, version']
					]
				};
			default:
				return {
					plain: m.mail_dirfail_plain_default(),
					rows: [
						[m.mail_dirfail_error_code(), inner],
						[m.mail_dirfail_address(), addr]
					]
				};
		}
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
