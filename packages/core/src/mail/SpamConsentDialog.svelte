<script lang="ts">
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
	title="Help the spam filter learn?"
	confirmLabel="Share headers"
	cancelLabel="Don't share"
	{busy}
	{error}
	onConfirm={() => onAnswer(true)}
	onCancel={() => onAnswer(false)}
	{onClose}
>
	{#snippet body()}
		<p class="cfd-p">
			When you report spam, we can send the message headers with the report. Headers show who sent
			the message and which servers it passed through, and they teach our spam filter what to
			catch. The body stays encrypted and is never sent.
		</p>
		<p class="cfd-p">
			We'll remember your answer for this account. You can change it later in Settings under
			Security.
		</p>
	{/snippet}
</ConfirmDialog>
