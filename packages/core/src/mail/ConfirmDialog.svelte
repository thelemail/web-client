<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import type { Snippet } from 'svelte';
	import { m } from '$paraglide/messages.js';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';

	interface Props {
		icon?: IconDefinition;
		title: string;
		sub?: string;
		tone?: 'danger' | 'neutral';
		confirmLabel: string;
		cancelLabel?: string;
		busy?: boolean;
		disabled?: boolean;
		error?: string | null;
		body?: Snippet;
		wide?: boolean;
		extraClass?: string;
		onConfirm: () => void;
		onCancel?: () => void;
		onClose: () => void;
	}

	let {
		icon,
		title,
		sub = '',
		tone = 'neutral',
		confirmLabel,
		cancelLabel,
		busy = false,
		disabled = false,
		error = null,
		body,
		wide = false,
		extraClass = '',
		onConfirm,
		onCancel,
		onClose
	}: Props = $props();

	let cancelRef = $state<HTMLElement | null>(null);
	let confirmRef = $state<HTMLElement | null>(null);

	function cancel() {
		if (busy) return;
		(onCancel ?? onClose)();
	}

	function autoFocus(e: Event) {
		e.preventDefault();
		const content = (e.currentTarget ?? e.target) as HTMLElement | null;
		if (content?.contains(document.activeElement)) return;
		const field = content?.querySelector<HTMLElement>(
			'[data-autofocus], input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)'
		);
		(field ?? (tone === 'danger' ? cancelRef : confirmRef) ?? cancelRef)?.focus();
	}
</script>

<Dialog.Root
	bind:open={
		() => true,
		(open) => {
			if (!open && !busy) onClose();
		}
	}
>
	<Dialog.Content
		size={wide ? 'wide' : 'md'}
		class={extraClass}
		showCloseButton={!busy}
		escapeKeydownBehavior={busy ? 'ignore' : 'close'}
		interactOutsideBehavior={busy ? 'ignore' : 'close'}
		onOpenAutoFocus={autoFocus}
	>
		<Dialog.Header {icon} tone={tone === 'danger' ? 'danger' : 'brand'}>
			<Dialog.Title>{title}</Dialog.Title>
			{#if sub}
				<Dialog.Description class="dialog-sub" title={sub}>{sub}</Dialog.Description>
			{/if}
		</Dialog.Header>

		{#if body}
			<div class="dialog-body">{@render body()}</div>
		{/if}

		{#if error}
			<div class="dialog-err" role="alert">{error}</div>
		{/if}

		<Dialog.Footer>
			<Button bind:ref={cancelRef} variant="neutral" disabled={busy} onclick={cancel}>
				{cancelLabel ?? m.common_cancel()}
			</Button>
			<Button
				bind:ref={confirmRef}
				variant={tone === 'danger' ? 'danger' : 'primary'}
				disabled={disabled}
				{busy}
				busyLabel={m.mail_confirm_working()}
				onclick={onConfirm}
			>
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
