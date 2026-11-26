<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import { trapFocus } from '$core/actions/trapFocus';
	import { m } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { faXmark } from '@fortawesome/pro-regular-svg-icons';
	import './confirm-dialog.css';
	import type { Snippet } from 'svelte';
	import { Button } from '$core/components/ui/button';

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
		extraClass?: string;
		onConfirm: () => void;
		onCancel?: () => void;
		onClose: () => void;
	}

	let {
		icon: glyph,
		title,
		sub = '',
		tone = 'neutral',
		confirmLabel,
		cancelLabel,
		busy = false,
		disabled = false,
		error = null,
		body,
		extraClass = '',
		onConfirm,
		onCancel,
		onClose
	}: Props = $props();

	const uid = $props.id();
	const titleId = `${uid}-title`;

	function close() {
		if (busy) return;
		onClose();
	}

	function cancel() {
		if (busy) return;
		(onCancel ?? onClose)();
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
	class="cfd-scrim {extraClass}"
	role="dialog"
	aria-modal="true"
	use:trapFocus
	aria-labelledby={titleId}
	tabindex="-1"
	onmousedown={scrimMouseDown}
>
	<div class="cfd-modal {tone}" role="presentation" onmousedown={(e) => e.stopPropagation()}>
		<div class="cfd-head">
			{#if glyph}
				<span class="cfd-ic"><Icon icon={glyph} size={17} /></span>
			{/if}
			<div class="cfd-tx">
				<h2 class="cfd-title" id={titleId}>{title}</h2>
				{#if sub}
					<div class="cfd-sub" title={sub}>{sub}</div>
				{/if}
			</div>
			<button type="button" class="cfd-x" title={m.common_close()} disabled={busy} onclick={close}>
				<Icon icon={faXmark} size={16} />
			</button>
		</div>

		{#if body}
			<div class="cfd-body">{@render body()}</div>
		{/if}

		{#if error}
			<div class="cfd-err" role="alert">{error}</div>
		{/if}

		<div class="cfd-actions">
			<Button variant="neutral" disabled={busy} onclick={cancel}>
				{cancelLabel ?? m.common_cancel()}
			</Button>
			<Button
				variant={tone === 'danger' ? 'danger' : 'primary'}
				disabled={busy || disabled}
				onclick={onConfirm}
			>
				{busy ? m.mail_confirm_working() : confirmLabel}
			</Button>
		</div>
	</div>
</div>
