<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ConfirmDialog from './ConfirmDialog.svelte';

	interface Props {
		busy?: boolean;
		error?: string | null;
		onAnswer: (share: boolean) => void;
		onClose: () => void;
	}

	let { busy = false, error = null, onAnswer, onClose }: Props = $props();
</script>

<ConfirmDialog
	icon={ShieldCheck}
	title={m.mail_spam_consent_title()}
	confirmLabel={m.mail_spam_consent_confirm()}
	cancelLabel={m.mail_spam_consent_decline()}
	{busy}
	{error}
	onConfirm={() => onAnswer(true)}
	onCancel={() => onAnswer(false)}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">{m.mail_spam_consent_body()}</p>
		<p class="cfd-p">{m.mail_spam_consent_remember()}</p>
	{/snippet}
</ConfirmDialog>
