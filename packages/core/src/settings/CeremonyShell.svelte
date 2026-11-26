<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import { trapFocus } from '$core/actions/trapFocus';
	import type { Snippet } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import { faCheck, faXmark } from '@fortawesome/pro-regular-svg-icons';
	import { m } from '$paraglide/messages.js';
	import { setHeadingLevel, setRowNames } from './a11y';

	interface Props {
		icon: IconDefinition;
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
		icon,
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

	const uid = $props.id();

	setRowNames(undefined);
	setHeadingLevel(3);

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
		use:trapFocus
		aria-labelledby="{uid}-title"
		tabindex="-1"
		onmousedown={(e) => e.stopPropagation()}
	>
		<header class="cer-head">
			<span class="cer-ic"><Icon {icon} size={19} /></span>
			<div class="cer-htext">
				<div class="cer-eyebrow">{eyebrow}</div>
				<h2 class="cer-title" id="{uid}-title">{title}</h2>
			</div>
			<Button variant="ghost" size="icon-sm" onclick={onClose} aria-label={m.common_close()}>
				<Icon icon={faXmark} size={18} />
			</Button>
		</header>

		{#if steps && steps.length > 1}
			<ol class="cer-steps">
				{#each steps as label, i (i)}
					<li
						class={'cer-step' + (i === step ? ' on' : '') + (i < step ? ' done' : '')}
						aria-current={i === step ? 'step' : undefined}
					>
						<span class="cs-dot" aria-hidden="true">
							{#if i < step}<Icon icon={faCheck} size={12} />{:else}{i + 1}{/if}
						</span>
						<span class="cs-lbl">{label}</span>
						{#if i < step}<span class="sr-only">{m.settings_step_completed()}</span>{/if}
						{#if i < steps.length - 1}<span class="cs-line"></span>{/if}
					</li>
				{/each}
			</ol>
		{/if}

		<div class="cer-body">{@render children()}</div>
		{#if footer && !hideFooter}<footer class="cer-foot">{@render footer()}</footer>{/if}
	</div>
</div>
