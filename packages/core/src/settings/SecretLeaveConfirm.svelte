<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		desc: string;
		onStay: () => void;
		onLeave: () => void;
	}

	let { desc, onStay, onLeave }: Props = $props();
</script>

{#snippet body()}<p class="cfd-p">{desc}</p>{/snippet}

<div class="leave-layer">
	<ConfirmDialog
		icon={TriangleAlert}
		tone="danger"
		title={m.settings_secret_leave_title()}
		cancelLabel={m.settings_secret_leave_stay()}
		confirmLabel={m.settings_secret_leave_confirm()}
		{body}
		onConfirm={onLeave}
		onClose={onStay}
	/>
</div>

<style>
	.leave-layer :global(.cfd-scrim) {
		z-index: 1100;
	}
</style>
