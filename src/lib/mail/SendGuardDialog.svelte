<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import {
		sendGuardConfirmLabel,
		sendGuardReasons,
		sendGuardTitle,
		type SendGuard
	} from './sendGuards';

	interface Props {
		guards: SendGuard[];
		busy?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	}

	let { guards, busy = false, onConfirm, onCancel }: Props = $props();

	const reasons = $derived(sendGuardReasons(guards));
</script>

<ConfirmDialog
	icon={ShieldAlert}
	title={sendGuardTitle(guards)}
	confirmLabel={sendGuardConfirmLabel(guards)}
	cancelLabel="Keep editing"
	{busy}
	{body}
	onConfirm={onConfirm}
	onClose={onCancel}
/>

{#snippet body()}
	<ul class="sg-list">
		{#each reasons as reason (reason)}
			<li>{reason}</li>
		{/each}
	</ul>
{/snippet}

<style>
	.sg-list {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 13.5px;
		line-height: 1.5;
		color: var(--fg-muted);
	}
</style>
