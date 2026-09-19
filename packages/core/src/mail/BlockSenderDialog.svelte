<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import UserX from '@lucide/svelte/icons/user-x';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import Rich from '$core/i18n/Rich.svelte';
	import { blockSender } from './blockedSenders';
	import { auth } from '$core/stores/auth.svelte';

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
			error = m.mail_block_unlock_required();
			return;
		}
		busy = true;
		error = null;
		try {
			await blockSender(accountId, address);
			onBlocked(address, moveExisting && existingCount > 0);
			onClose();
		} catch (e) {
			error = e instanceof Error && e.message ? e.message : m.mail_block_failed();
		} finally {
			busy = false;
		}
	}
</script>

<ConfirmDialog
	icon={UserX}
	title={m.mail_block_title()}
	sub={displayName && displayName !== address ? `${displayName} · ${address}` : address}
	confirmLabel={m.mail_block_confirm()}
	{busy}
	{error}
	onConfirm={() => void confirm()}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">
			<Rich text={m.mail_block_body({ address })} tags={{ mono }} />
		</p>
		<p class="cfd-p">{m.mail_block_unblock_hint()}</p>

		{#if existingCount > 0}
			<label class="cfd-check">
				<input type="checkbox" bind:checked={moveExisting} disabled={busy} />
				<span>
					<span class="cfd-check-t">
						{m.mail_block_move_existing({ count: existingCount })}
					</span>
					<span class="cfd-check-d">
						{m.mail_block_move_existing_detail()}
					</span>
				</span>
			</label>
		{/if}
	{/snippet}
</ConfirmDialog>

{#snippet mono(t: string)}<span class="cfd-mono">{t}</span>{/snippet}
