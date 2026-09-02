<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import './confirm-dialog.css';
	import type { Component, Snippet } from 'svelte';

	interface Props {
		icon?: Component;
		title: string;
		sub?: string;
		tone?: 'danger' | 'neutral';
		confirmLabel: string;
		cancelLabel?: string;
		busy?: boolean;
		disabled?: boolean;
		error?: string | null;
		body?: Snippet;
		onConfirm: () => void;
		onClose: () => void;
	}

	let {
		icon: Icon,
		title,
		sub = '',
		tone = 'neutral',
		confirmLabel,
		cancelLabel = 'Cancel',
		busy = false,
		disabled = false,
		error = null,
		body,
		onConfirm,
		onClose
	}: Props = $props();

	function close() {
		if (busy) return;
		onClose();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.stopPropagation();
		close();
	}

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) close();
	}
</script>

<svelte:document onkeydowncapture={handleKey} />

<div
	class="cfd-scrim"
	role="dialog"
	aria-modal="true"
	aria-labelledby="cfd-title"
	tabindex="-1"
	onmousedown={scrimMouseDown}
>
	<div class="cfd-modal {tone}" role="presentation" onmousedown={(e) => e.stopPropagation()}>
		<div class="cfd-head">
			{#if Icon}
				<span class="cfd-ic"><Icon size={17} /></span>
			{/if}
			<div class="cfd-tx">
				<h2 class="cfd-title" id="cfd-title">{title}</h2>
				{#if sub}
					<div class="cfd-sub" title={sub}>{sub}</div>
				{/if}
			</div>
			<button type="button" class="cfd-x" title="Close" disabled={busy} onclick={close}>
				<X size={16} />
			</button>
		</div>

		{#if body}
			<div class="cfd-body">{@render body()}</div>
		{/if}

		{#if error}
			<div class="cfd-err" role="alert">{error}</div>
		{/if}

		<div class="cfd-actions">
			<button type="button" class="cfd-btn ghost" disabled={busy} onclick={close}>
				{cancelLabel}
			</button>
			<button
				type="button"
				class="cfd-btn {tone === 'danger' ? 'danger' : 'primary'}"
				disabled={busy || disabled}
				onclick={onConfirm}
			>
				{busy ? 'Working…' : confirmLabel}
			</button>
		</div>
	</div>
</div>
