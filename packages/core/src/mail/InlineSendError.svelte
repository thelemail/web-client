<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import { m as msg } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import {
		faArrowRightToBracket,
		faArrowsRotate,
		faAt,
		faCircleExclamation,
		faKey,
		faLock,
		faPencil,
		faRotateRight,
		faServer,
		faShieldExclamation,
		faTimer,
		faWifiSlash,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import Rich from '$core/i18n/Rich.svelte';

	export type InlineErrorCode =
		| 'recipient_unknown'
		| 'locked'
		| 'no_account'
		| 'encrypt'
		| 'encryption_downgrade'
		| 'recipient_key_invalid'
		| 'rate_limited'
		| 'schedule_unsupported'
		| 'malware_blocked'
		| 'rejected'
		| 'server_error'
		| 'network';

	interface Recipient {
		name: string;
		email: string;
	}

	interface Props {
		code: InlineErrorCode;
		attempts: number;
		recipient: Recipient;
		retryAfterSeconds?: number;
		message?: string;
		onEditRecipient: () => void;
		onUnlock: () => void;
		onRetry: () => void;
		onDismiss: () => void;
	}

	let {
		code,
		attempts,
		recipient,
		retryAfterSeconds = 0,
		message = '',
		onEditRecipient,
		onUnlock,
		onRetry,
		onDismiss
	}: Props = $props();

	function waitText(seconds: number): string {
		if (seconds <= 0) return msg.mail_send_err_wait_little();
		if (seconds < 60) return msg.mail_send_err_wait_under_minute();
		if (seconds < 3600) return msg.mail_send_err_wait_minutes({ count: Math.ceil(seconds / 60) });
		return msg.mail_send_err_wait_hours({ count: Math.ceil(seconds / 3600) });
	}

	type Tone = 'info' | 'pine' | 'warn';

	interface Conf {
		tone: Tone;
		ic: IconDefinition;
		title: string;
		actionLabel: string;
		actionIcon: IconDefinition;
		onAction: () => void;
	}

	const reloadTab = () => {
		if (typeof window !== 'undefined') window.location.reload();
	};

	const serverText = $derived.by(() => {
		const m = message.trim();
		if (!m) return msg.mail_send_err_server_default();
		return /[.!?]$/.test(m) ? m : `${m}.`;
	});

	const conf = $derived.by<Conf>(() => {
		switch (code) {
			case 'recipient_unknown':
				return {
					tone: 'info',
					ic: faAt,
					title: msg.mail_send_err_unknown_title(),
					actionLabel: msg.mail_send_err_edit_recipient(),
					actionIcon: faPencil,
					onAction: onEditRecipient
				};
			case 'locked':
				return {
					tone: 'pine',
					ic: faLock,
					title: msg.mail_send_err_locked_title(),
					actionLabel: msg.mail_send_err_unlock(),
					actionIcon: faKey,
					onAction: onUnlock
				};
			case 'no_account':
				return {
					tone: 'pine',
					ic: faArrowRightToBracket,
					title: msg.mail_send_err_signed_out_title(),
					actionLabel: msg.mail_send_err_sign_in(),
					actionIcon: faArrowRightToBracket,
					onAction: onUnlock
				};
			case 'encrypt':
				return attempts >= 2
					? {
							tone: 'warn',
							ic: faCircleExclamation,
							title: msg.mail_send_err_encrypt_title(),
							actionLabel: msg.mail_send_err_reload(),
							actionIcon: faRotateRight,
							onAction: reloadTab
						}
					: {
							tone: 'warn',
							ic: faCircleExclamation,
							title: msg.mail_send_err_encrypt_title(),
							actionLabel: msg.common_retry(),
							actionIcon: faArrowsRotate,
							onAction: onRetry
						};
			case 'encryption_downgrade':
				return {
					tone: 'warn',
					ic: faShieldExclamation,
					title: msg.mail_send_err_downgrade_title(),
					actionLabel: msg.mail_send_err_back_to_draft(),
					actionIcon: faPencil,
					onAction: onDismiss
				};
			case 'recipient_key_invalid':
				return {
					tone: 'warn',
					ic: faCircleExclamation,
					title: msg.mail_send_err_key_invalid_title(),
					actionLabel: msg.common_retry(),
					actionIcon: faArrowsRotate,
					onAction: onRetry
				};
			case 'rate_limited':
				return {
					tone: 'warn',
					ic: faTimer,
					title: msg.mail_send_err_rate_title(),
					actionLabel: msg.mail_send_err_got_it(),
					actionIcon: faTimer,
					onAction: onDismiss
				};
			case 'schedule_unsupported':
				return {
					tone: 'info',
					ic: faTimer,
					title: msg.mail_send_err_schedule_title(),
					actionLabel: msg.mail_send_err_back_to_draft(),
					actionIcon: faPencil,
					onAction: onDismiss
				};
			case 'malware_blocked':
				return {
					tone: 'warn',
					ic: faShieldExclamation,
					title: msg.mail_send_err_malware_title(),
					actionLabel: msg.mail_send_err_back_to_draft(),
					actionIcon: faPencil,
					onAction: onDismiss
				};
			case 'rejected':
				return {
					tone: 'warn',
					ic: faCircleExclamation,
					title: msg.mail_send_err_rejected_title(),
					actionLabel: msg.mail_send_err_back_to_draft(),
					actionIcon: faPencil,
					onAction: onDismiss
				};
			case 'server_error':
				return {
					tone: 'warn',
					ic: faServer,
					title: msg.mail_send_err_server_title(),
					actionLabel: msg.common_retry(),
					actionIcon: faArrowsRotate,
					onAction: onRetry
				};
			case 'network':
			default:
				return {
					tone: 'warn',
					ic: faWifiSlash,
					title: msg.mail_send_err_network_title(),
					actionLabel: msg.common_retry(),
					actionIcon: faArrowsRotate,
					onAction: onRetry
				};
		}
	});
</script>

<div class={'se-banner se-' + conf.tone} role="alert">
	<span class="se-ic"><Icon icon={conf.ic} size={17} /></span>
	<div class="se-body">
		<div class="se-title">{conf.title}</div>
		<div class="se-text">
			{#if code === 'recipient_unknown'}
				<Rich text={msg.mail_send_err_unknown_text({ email: recipient.email })} tags={{ code: mono }} />
			{:else if code === 'locked'}
				{msg.mail_send_err_locked_text()}
			{:else if code === 'no_account'}
				{msg.mail_send_err_signed_out_text()}
			{:else if code === 'encrypt'}
				{#if attempts >= 2}
					{msg.mail_send_err_encrypt_again_text()}
				{:else}
					{msg.mail_send_err_encrypt_text()}
				{/if}
			{:else if code === 'encryption_downgrade'}
				<Rich text={msg.mail_send_err_downgrade_text({ email: recipient.email })} tags={{ code: mono }} />
			{:else if code === 'recipient_key_invalid'}
				{msg.mail_send_err_key_invalid_text()}
			{:else if code === 'rate_limited'}
				{msg.mail_send_err_rate_text({ wait: waitText(retryAfterSeconds) })}
			{:else if code === 'schedule_unsupported'}
				{msg.mail_send_err_not_sent_text({ server: serverText })}
			{:else if code === 'malware_blocked'}
				{msg.mail_send_err_malware_text({ server: serverText })}
			{:else if code === 'rejected'}
				{msg.mail_send_err_not_sent_text({ server: serverText })}
			{:else if code === 'server_error'}
				{msg.mail_send_err_server_text({ server: serverText })}
			{:else}
				{msg.mail_send_err_network_text()}
			{/if}
		</div>
	</div>
	<div class="se-acts">
		<Button variant={conf.tone === 'warn' ? 'caution' : 'primary'} size="sm" onclick={conf.onAction}>
			<Icon icon={conf.actionIcon} size={14} />{conf.actionLabel}
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={msg.mail_send_err_dismiss()}
			title={msg.mail_send_err_dismiss()}
			onclick={onDismiss}
		>
			<Icon icon={faXmark} size={15} />
		</Button>
	</div>
</div>

{#snippet mono(t: string)}<code class="se-mono">{t}</code>{/snippet}
