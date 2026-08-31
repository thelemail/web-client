<script lang="ts">
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
		if (seconds <= 0) return 'a little while';
		if (seconds < 60) return 'less than a minute';
		if (seconds < 3600) {
			const m = Math.ceil(seconds / 60);
			return m === 1 ? 'about a minute' : `about ${m} minutes`;
		}
		const h = Math.ceil(seconds / 3600);
		return h === 1 ? 'about an hour' : `about ${h} hours`;
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
		if (!m) return 'The server did not accept the request.';
		return /[.!?]$/.test(m) ? m : `${m}.`;
	});

	const conf = $derived.by<Conf>(() => {
		switch (code) {
			case 'recipient_unknown':
				return {
					tone: 'info',
					ic: AtSign,
					title: 'No Thelemail account at that address',
					actionLabel: 'Edit recipient',
					actionIcon: Pencil,
					onAction: onEditRecipient
				};
			case 'locked':
				return {
					tone: 'pine',
					ic: Lock,
					title: 'Your vault is locked',
					actionLabel: 'Unlock vault',
					actionIcon: KeyRound,
					onAction: onUnlock
				};
			case 'no_account':
				return {
					tone: 'pine',
					ic: LogIn,
					title: "You're signed out",
					actionLabel: 'Sign in',
					actionIcon: LogIn,
					onAction: onUnlock
				};
			case 'encrypt':
				return attempts >= 2
					? {
							tone: 'warn',
							ic: CircleAlert,
							title: "Encryption didn't complete",
							actionLabel: 'Reload the tab',
							actionIcon: RotateCw,
							onAction: reloadTab
						}
					: {
							tone: 'warn',
							ic: CircleAlert,
							title: "Encryption didn't complete",
							actionLabel: 'Try again',
							actionIcon: RefreshCw,
							onAction: onRetry
						};
			case 'recipient_key_invalid':
				return {
					tone: 'warn',
					ic: CircleAlert,
					title: "Couldn't read the recipient's key",
					actionLabel: 'Try again',
					actionIcon: RefreshCw,
					onAction: onRetry
				};
			case 'rate_limited':
				return {
					tone: 'warn',
					ic: Timer,
					title: "You've reached your sending limit",
					actionLabel: 'Got it',
					actionIcon: Timer,
					onAction: onDismiss
				};
			case 'schedule_unsupported':
				return {
					tone: 'info',
					ic: Timer,
					title: "This mix of recipients can't be scheduled",
					actionLabel: 'Back to the draft',
					actionIcon: Pencil,
					onAction: onDismiss
				};
			case 'malware_blocked':
				return {
					tone: 'warn',
					ic: ShieldAlert,
					title: 'This message contains malware',
					actionLabel: 'Back to the draft',
					actionIcon: Pencil,
					onAction: onDismiss
				};
			case 'rejected':
				return {
					tone: 'warn',
					ic: CircleAlert,
					title: 'The server turned this message down',
					actionLabel: 'Back to the draft',
					actionIcon: Pencil,
					onAction: onDismiss
				};
			case 'server_error':
				return {
					tone: 'warn',
					ic: ServerCrash,
					title: 'Something went wrong on our side',
					actionLabel: 'Try again',
					actionIcon: RefreshCw,
					onAction: onRetry
				};
			case 'network':
			default:
				return {
					tone: 'warn',
					ic: WifiOff,
					title: "Couldn't reach the server",
					actionLabel: 'Try again',
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
				There's no mailbox at <code class="se-mono">{recipient.email}</code> on Thelemail. Most often
				that's a small typo in the address.
			{:else if code === 'locked'}
				Thelemail needs your vault unlocked in this tab before it can encrypt and send. Your draft is
				kept.
			{:else if code === 'no_account'}
				This tab isn't signed in to an account. Sign in to send — your draft is kept here.
			{:else if code === 'encrypt'}
				{#if attempts >= 2}
					The local encryption step failed again. This is usually environmental — reloading the tab
					clears it. Your draft is kept.
				{:else}
					Something went wrong while encrypting this message on your device. This is usually
					temporary.
				{/if}
			{:else if code === 'recipient_key_invalid'}
				The recipient's public key couldn't be parsed, so nothing was encrypted. Trying again often
				resolves it.
			{:else if code === 'rate_limited'}
				To keep Thelemail safe from abuse, sending is capped per account. You can send again in
				{waitText(retryAfterSeconds)}. Your draft is kept.
			{:else if code === 'schedule_unsupported'}
				{serverText}
				Nothing was sent and your draft is kept.
			{:else if code === 'malware_blocked'}
				{serverText}
				Your draft is kept. Remove the attachment before trying again.
			{:else if code === 'rejected'}
				{serverText}
				Nothing was sent and your draft is kept.
			{:else if code === 'server_error'}
				{serverText}
				Nothing was sent and your draft is kept. Trying again in a moment usually works.
			{:else}
				The request didn't make it through. Nothing was sent and your draft is kept. Check your
				connection and try again.
			{/if}
		</div>
	</div>
	<div class="se-acts">
		<button type="button" class="se-btn primary" onclick={conf.onAction}>
			<conf.actionIcon size={14} />{conf.actionLabel}
		</button>
		<button type="button" class="se-x" title="Dismiss" onclick={onDismiss}>
			<X size={15} />
		</button>
	</div>
</div>
