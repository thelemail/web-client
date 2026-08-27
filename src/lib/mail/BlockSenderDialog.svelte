<script lang="ts">
	import UserX from '@lucide/svelte/icons/user-x';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { blockSender } from './blockedSenders';
	import { auth } from '$lib/stores/auth.svelte';

	interface Props {
		address: string;
		displayName?: string;
		existingCount?: number;
		onClose: () => void;
		onBlocked: (address: string, moveExisting: boolean) => void;
	}

	let {
		address,
		displayName = '',
		existingCount = 0,
		onClose,
		onBlocked
	}: Props = $props();

	let moveExisting = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function confirm() {
		const accountId = auth.accountId;
		if (!accountId) {
			error = 'Unlock this account to block a sender.';
			return;
		}
		busy = true;
		error = null;
		try {
			await blockSender(accountId, address);
			onBlocked(address, moveExisting && existingCount > 0);
			onClose();
		} catch (e) {
			error = e instanceof Error && e.message ? e.message : 'The sender could not be blocked.';
		} finally {
			busy = false;
		}
	}
</script>

<ConfirmDialog
	icon={UserX}
	title="Block this sender"
	sub={displayName && displayName !== address ? `${displayName} · ${address}` : address}
	confirmLabel="Block sender"
	{busy}
	{error}
	onConfirm={() => void confirm()}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">
			New mail from <span class="cfd-mono">{address}</span> goes straight to Spam and raises no
			notification. The address is stored as a keyed hash, so the server never sees it in the
			clear, and the label you see here is encrypted to your key.
		</p>
		<p class="cfd-p">You can unblock the address from Settings at any time.</p>

		{#if existingCount > 0}
			<label class="cfd-check">
				<input type="checkbox" bind:checked={moveExisting} disabled={busy} />
				<span>
					<span class="cfd-check-t">
						Also move {existingCount} loaded message{existingCount === 1 ? '' : 's'} to Spam
					</span>
					<span class="cfd-check-d">
						Applies to the messages from this sender your browser has already decrypted. Older mail
						stays where it is until you open the folder that holds it.
					</span>
				</span>
			</label>
		{/if}
	{/snippet}
</ConfirmDialog>
