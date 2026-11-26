<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import type { Snippet } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import * as Dialog from '$core/components/ui/dialog';
	import { faCheck } from '@fortawesome/pro-regular-svg-icons';
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

	setRowNames(undefined);
	setHeadingLevel(3);
</script>

<Dialog.Root
	bind:open={
		() => true,
		(open) => {
			if (!open) onClose();
		}
	}
>
	<Dialog.Content class={'cer-panel' + (tone ? ' tone-' + tone : '')}>
		<Dialog.Header {icon} tone={tone ?? 'brand'}>
			<p class="cer-eyebrow">{eyebrow}</p>
			<Dialog.Title>{title}</Dialog.Title>
		</Dialog.Header>

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
		{#if footer && !hideFooter}<Dialog.Footer class="cer-foot">{@render footer()}</Dialog.Footer>{/if}
	</Dialog.Content>
</Dialog.Root>
