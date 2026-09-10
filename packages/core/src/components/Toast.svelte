<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	interface Props {
		text: string;
		undoLabel?: string;
		onUndo?: () => void;
		shift?: number;
	}

	let { text, undoLabel = 'Undo', onUndo, shift = 0 }: Props = $props();
</script>

<div class="toast" style:--toast-shift="{shift}px">
	<CircleCheck size={16} />{text}
	{#if onUndo}
		<button type="button" class="undo" onclick={onUndo}>{undoLabel}</button>
	{/if}
</div>

<style>
	.toast {
		position: fixed;
		bottom: 26px;
		left: calc(50% + var(--toast-shift, 0px));
		transform: translateX(-50%);
		z-index: 100;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 12px 17px;
		border-radius: var(--radius-md);
		background: var(--pine-900);
		color: var(--fg-on-pine);
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 500;
		box-shadow: var(--shadow-lg);
		animation: toast-in var(--dur) var(--ease-out);
	}
	.undo {
		margin-left: 6px;
		border: none;
		background: none;
		color: var(--brass-500);
		font-weight: 600;
		cursor: pointer;
	}
	:global([data-theme='dark']) .toast {
		border: 1px solid var(--border-dark);
	}
	@media (max-width: 1000px) {
		.toast {
			left: 50%;
		}
	}
	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%);
		}
	}
</style>
