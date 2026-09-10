<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';

	interface Props {
		icon: Component;
		eyebrow: string;
		title: string;
		tone?: 'danger';
		steps?: string[];
		step?: number;
		hideFooter?: boolean;
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
	}

	let {
		icon: IconComponent,
		eyebrow,
		title,
		tone,
		steps,
		step = 0,
		hideFooter = false,
		onClose,
		children,
		footer
	}: Props = $props();

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function scrimMouseDown(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<svelte:document onkeydown={handleKey} />

<div class="cer-scrim" role="presentation" onmousedown={scrimMouseDown}>
	<div
		class={'cer-panel' + (tone ? ' tone-' + tone : '')}
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		onmousedown={(e) => e.stopPropagation()}
	>
		<header class="cer-head">
			<span class="cer-ic"><IconComponent size={19} /></span>
			<div class="cer-htext">
				<div class="cer-eyebrow">{eyebrow}</div>
				<div class="cer-title">{title}</div>
			</div>
			<button type="button" class="cer-close" onclick={onClose} aria-label="Close">
				<X size={18} />
			</button>
		</header>

		{#if steps && steps.length > 1}
			<div class="cer-steps">
				{#each steps as label, i (i)}
					<div class={'cer-step' + (i === step ? ' on' : '') + (i < step ? ' done' : '')}>
						<span class="cs-dot">
							{#if i < step}<Check size={12} />{:else}{i + 1}{/if}
						</span>
						<span class="cs-lbl">{label}</span>
						{#if i < steps.length - 1}<span class="cs-line"></span>{/if}
					</div>
				{/each}
			</div>
		{/if}

		<div class="cer-body">{@render children()}</div>
		{#if footer && !hideFooter}<footer class="cer-foot">{@render footer()}</footer>{/if}
	</div>
</div>
