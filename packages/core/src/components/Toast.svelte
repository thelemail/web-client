<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faCircleCheck,
		faCircleExclamation,
		faCircleInfo
	} from '@fortawesome/pro-regular-svg-icons';
	import { m } from '$paraglide/messages.js';
	import { announce } from '$core/announce';

	interface Props {
		text: string;
		undoLabel?: string;
		onUndo?: () => void;
		shift?: number;
		tone?: 'success' | 'info' | 'error';
	}

	let { text, undoLabel, onUndo, shift = 0, tone = 'success' }: Props = $props();

	$effect(() => announce(text));
</script>

<div class="toast" class:error={tone === 'error'} style:--toast-shift="{shift}px">
	{#if tone === 'error'}<Icon icon={faCircleExclamation} size={16} />{:else if tone === 'info'}<Icon icon={faCircleInfo} size={16} />{:else}<Icon icon={faCircleCheck}
			size={16}
		/>{/if}{text}
	{#if onUndo}
		<button type="button" class="undo" onclick={onUndo}>{undoLabel ?? m.ui_toast_undo()}</button>
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
		background: var(--bg-inverse);
		color: var(--fg-on-pine);
		border: 1px solid color-mix(in oklab, var(--border-soft) 25%, transparent);
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 500;
		box-shadow: var(--shadow-lg);
		animation: toast-in var(--dur) var(--ease-out);
	}
	.toast.error > :global(svg) {
		color: var(--brass-on-inverse);
	}
	.undo {
		margin-left: 6px;
		border: none;
		background: none;
		color: var(--brass-on-inverse);
		font-weight: 600;
		cursor: pointer;
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
