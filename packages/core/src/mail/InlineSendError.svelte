<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Lock from '@lucide/svelte/icons/lock';
	import LogIn from '@lucide/svelte/icons/log-in';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import ServerCrash from '@lucide/svelte/icons/server-crash';
	import Pencil from '@lucide/svelte/icons/pencil';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Timer from '@lucide/svelte/icons/timer';
	import X from '@lucide/svelte/icons/x';
	import Rich from '$core/i18n/Rich.svelte';

	export type InlineErrorCode =
		| 'recipient_unknown'
		| 'locked'
		| 'no_account'
		| 'encrypt'
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
	type IconComponent = typeof AtSign;

	interface Conf {
		tone: Tone;
		ic: IconComponent;
		title: string;
		actionLabel: string;
		actionIcon: IconComponent;
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
					ic: AtSign,
					title: msg.mail_send_err_unknown_title(),
					actionLabel: msg.mail_send_err_edit_recipient(),
					actionIcon: Pencil,
					onAction: onEditRecipient
				};
			case 'locked':
				return {
					tone: 'pine',
					ic: Lock,
					title: msg.mail_send_err_locked_title(),
					actionLabel: msg.mail_send_err_unlock(),
					actionIcon: KeyRound,
					onAction: onUnlock
				};
			case 'no_account':
				return {
					tone: 'pine',
					ic: LogIn,
					title: msg.mail_send_err_signed_out_title(),
					actionLabel: msg.mail_send_err_sign_in(),
					actionIcon: LogIn,
					onAction: onUnlock
				};
			case 'encrypt':
				return attempts >= 2
					? {
							tone: 'warn',
							ic: CircleAlert,
							title: msg.mail_send_err_encrypt_title(),
							actionLabel: msg.mail_send_err_reload(),
							actionIcon: RotateCw,
							onAction: reloadTab
						}
					: {
							tone: 'warn',
							ic: CircleAlert,
							title: msg.mail_send_err_encrypt_title(),
							actionLabel: msg.common_retry(),
							actionIcon: RefreshCw,
							onAction: onRetry
						};
			case 'recipient_key_invalid':
				return {
					tone: 'warn',
					ic: CircleAlert,
					title: msg.mail_send_err_key_invalid_title(),
					actionLabel: msg.common_retry(),
					actionIcon: RefreshCw,
					onAction: onRetry
				};
			case 'rate_limited':
				return {
					tone: 'warn',
					ic: Timer,
					title: msg.mail_send_err_rate_title(),
					actionLabel: msg.mail_send_err_got_it(),
					actionIcon: Timer,
					onAction: onDismiss
				};
			case 'schedule_unsupported':
				return {
					tone: 'info',
					ic: Timer,
					title: msg.mail_send_err_schedule_title(),
					actionLabel: msg.mail_send_err_back_to_draft(),
					actionIcon: Pencil,
					onAction: onDismiss
				};
			case 'malware_blocked':
				return {
					tone: 'warn',
					ic: ShieldAlert,
					title: msg.mail_send_err_malware_title(),
					actionLabel: msg.mail_send_err_back_to_draft(),
					actionIcon: Pencil,
					onAction: onDismiss
				};
			case 'rejected':
				return {
					tone: 'warn',
					ic: CircleAlert,
					title: msg.mail_send_err_rejected_title(),
					actionLabel: msg.mail_send_err_back_to_draft(),
					actionIcon: Pencil,
					onAction: onDismiss
				};
			case 'server_error':
				return {
					tone: 'warn',
					ic: ServerCrash,
					title: msg.mail_send_err_server_title(),
					actionLabel: msg.common_retry(),
					actionIcon: RefreshCw,
					onAction: onRetry
				};
			case 'network':
			default:
				return {
					tone: 'warn',
					ic: WifiOff,
					title: msg.mail_send_err_network_title(),
					actionLabel: msg.common_retry(),
					actionIcon: RefreshCw,
					onAction: onRetry
				};
		}
	});
</script>

<div class={'se-banner se-' + conf.tone} role="alert">
	<span class="se-ic"><conf.ic size={17} /></span>
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
		<button type="button" class="se-btn primary" onclick={conf.onAction}>
			<conf.actionIcon size={14} />{conf.actionLabel}
		</button>
		<button type="button" class="se-x" title={msg.mail_send_err_dismiss()} onclick={onDismiss}>
			<X size={15} />
		</button>
	</div>
</div>

{#snippet mono(t: string)}<code class="se-mono">{t}</code>{/snippet}
