<script lang="ts">
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { auth } from '$lib/stores/auth.svelte';
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
			error = e instanceof Error && e.message ? e.message : 'The account could not be removed.';
		} finally {
			busy = false;
		}
	}
</script>

<ConfirmDialog
	icon={UserMinus}
	tone="danger"
	title="Remove account from this device"
	sub={name && name !== email ? `${name} · ${email}` : email}
	confirmLabel="Remove account"
	{busy}
	{error}
	onConfirm={() => void confirm()}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">
			This signs <span class="cfd-mono">{email}</span> out here and forgets its keys on this
			device{#if mirrored}, together with the mail mirrored to it{/if}. The account itself is not
			changed, and you can sign in to it again at any time.
		</p>
	{/snippet}
</ConfirmDialog>
