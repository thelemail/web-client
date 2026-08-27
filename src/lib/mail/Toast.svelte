<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	interface Props {
		text: string;
		undoLabel?: string;
		onUndo?: () => void;
	}

	let { text, undoLabel = 'Undo', onUndo }: Props = $props();
</script>

<div class="mail-toast">
	<CircleCheck size={16} />{text}
	{#if onUndo}
		<button type="button" class="undo" onclick={onUndo}>{undoLabel}</button>
	{/if}
</div>
