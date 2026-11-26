<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faCircleExclamation, faXmark } from '@fortawesome/pro-regular-svg-icons';
	import { m } from '$paraglide/messages.js';
	import { announce } from '$core/announce';

	interface Props {
		text: string;
		undoLabel?: string;
		onUndo?: () => void;
		onDismiss?: () => void;
		shift?: number;
		tone?: 'success' | 'info' | 'error';
	}

	let { text, undoLabel, onUndo, onDismiss, shift = 0, tone = 'success' }: Props = $props();

	$effect(() => announce(text));
</script>

<div class="toast-slot" style:--toast-shift="{shift}px">
	<div class="toast-bar" data-tone={tone}>
		{#if tone === 'error'}<Icon icon={faCircleExclamation} size={16} />{/if}
		<span class="toast-text">{text}</span>
		{#if onUndo}
			<button type="button" class="toast-action" onclick={onUndo}>{undoLabel ?? m.ui_toast_undo()}</button>
		{/if}
		{#if onDismiss}
			<button type="button" class="toast-dismiss" aria-label={m.common_close()} onclick={onDismiss}>
				<Icon icon={faXmark} size={14} />
			</button>
		{/if}
	</div>
</div>

<style>
	.toast-slot {
		position: fixed;
		bottom: max(24px, env(safe-area-inset-bottom, 0px));
		left: calc(50% + var(--toast-shift, 0px));
		z-index: var(--z-toast);
		transform: translateX(-50%);
	}
	@media (max-width: 1000px) {
		.toast-slot {
			left: 50%;
		}
	}
</style>
