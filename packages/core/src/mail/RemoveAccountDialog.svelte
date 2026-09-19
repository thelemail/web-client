<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import Rich from '$core/i18n/Rich.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { platform } from '$platform';

	interface Props {
		accountId: string;
		email: string;
		name?: string | null;
		onClose: () => void;
		onRemoved: () => void;
	}

	let { accountId, email, name = null, onClose, onRemoved }: Props = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	const mirrored = !!platform.mirror;

	async function confirm() {
		busy = true;
		error = null;
		try {
			await auth.logoutAccount(accountId);
			onRemoved();
			onClose();
		} catch (e) {
			error = e instanceof Error && e.message ? e.message : m.mail_remove_account_failed();
		} finally {
			busy = false;
		}
	}
</script>

<ConfirmDialog
	icon={UserMinus}
	tone="danger"
	title={m.mail_remove_account_title()}
	sub={name && name !== email ? `${name} · ${email}` : email}
	confirmLabel={m.mail_remove_account_confirm()}
	{busy}
	{error}
	onConfirm={() => void confirm()}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">
			<Rich
				text={mirrored
					? m.mail_remove_account_body_mirrored({ email })
					: m.mail_remove_account_body({ email })}
				tags={{ mono }}
			/>
		</p>
	{/snippet}
</ConfirmDialog>

{#snippet mono(t: string)}<span class="cfd-mono">{t}</span>{/snippet}
