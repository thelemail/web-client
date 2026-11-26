<script lang="ts">
	import { faTriangleExclamation } from '@fortawesome/pro-regular-svg-icons';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
	desc: string;
	onStay: () => void;
	onLeave: () => void;
	}

	let { desc, onStay, onLeave }: Props = $props();
</script>

{#snippet body()}<p class="dialog-p">{desc}</p>{/snippet}

<ConfirmDialog
	icon={faTriangleExclamation}
	tone="danger"
	title={m.settings_secret_leave_title()}
	cancelLabel={m.settings_secret_leave_stay()}
	confirmLabel={m.settings_secret_leave_confirm()}
	{body}
	onConfirm={onLeave}
	onClose={onStay}
/>

