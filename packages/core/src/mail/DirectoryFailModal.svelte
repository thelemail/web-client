<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowsRotate,
		faChevronDown,
		faChevronRight,
		faChevronUp,
		faLock,
		faPencil,
		faShieldExclamation
	} from '@fortawesome/pro-regular-svg-icons';
	import type { DirectoryVerificationCode } from '$core/directory/verify';
	import {
		LABEL_CURVE25519_LEGACY,
		LABEL_CURVE25519_V4,
		LABEL_CURVE25519_V6
	} from '$core/directory/keyLabel';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
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
</script>

<Dialog.Root
	bind:open={
		() => true,
		(open) => {
			if (!open) onCancel();
		}
	}
>
	<Dialog.Content alert size="wide" showCloseButton={false}>
		<Dialog.Header icon={faShieldExclamation} tone="danger" eyebrow={m.mail_dirfail_eyebrow()}>
			<Dialog.Title>{m.mail_dirfail_title()}</Dialog.Title>
			<Dialog.Description>
				<Rich text={m.mail_dirfail_lede({ name: recipient.name || recipient.email })} tags={{ b: bold }} />
			</Dialog.Description>
		</Dialog.Header>

		<div class="dialog-body dv-body">
			<div class="dv-finding">
				<p class="dv-finding-h">{m.mail_dirfail_what_we_found()}</p>
				<p>{finding.plain}</p>
			</div>

			<p class="dv-assure">
				<Icon icon={faLock} size={14} />
				{m.mail_dirfail_assure()}
			</p>

			<div>
				<button type="button" class="dv-disclose rot" aria-expanded={tech} onclick={() => (tech = !tech)}>
					<Icon icon={faChevronRight} size={14} />{m.mail_dirfail_show_details()}
				</button>
				{#if tech}
					<dl class="dv-tech">
						{#each finding.rows as [k, v], i (i)}
							<div class="dv-techrow">
								<dt>{k}</dt>
								<dd>{v}</dd>
							</div>
						{/each}
					</dl>
				{/if}
			</div>

			<div>
				<button type="button" class="dv-disclose" aria-expanded={what} onclick={() => (what = !what)}>
					{#if what}<Icon icon={faChevronUp} size={14} />{:else}<Icon icon={faChevronDown} size={14} />{/if}{m.mail_dirfail_what_is_this()}
				</button>
				{#if what}
					<p class="dialog-hint dv-explainer"><Rich text={m.mail_dirfail_explainer()} tags={{ i: italic }} /></p>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="neutral" onclick={onCancel}>{m.mail_dirfail_back_to_draft()}</Button>
			<Button variant="tonal" tooltip={m.mail_dirfail_retry_title()} onclick={onRetry}>
				<Icon icon={faArrowsRotate} size={15} />{m.common_retry()}
			</Button>
			<Button variant="primary" onclick={onEditRecipient}>
				<Icon icon={faPencil} size={15} />{m.mail_dirfail_edit_recipient()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet italic(t: string)}<i>{t}</i>{/snippet}
