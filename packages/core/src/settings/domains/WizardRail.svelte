<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { DOMAIN_STEPS, STEP_LABELS, type DomainStep } from './steps';

	interface Props {
		current: DomainStep;
		done: (s: DomainStep) => boolean;
		onSelect: (s: DomainStep) => void;
	}

	let { current, done, onSelect }: Props = $props();
</script>

<nav class="dw-rail" aria-label="Domain setup progress">
	{#each DOMAIN_STEPS as s, i (s)}
		<button
			type="button"
			class="dw-step"
			class:on={current === s}
			class:done={done(s)}
			aria-current={current === s ? 'step' : undefined}
			onclick={() => onSelect(s)}
		>
			<span class="dw-dot">
				{#if done(s)}<Check size={13} strokeWidth={2} />{:else}{i + 1}{/if}
			</span>
			<span class="dw-lbl">{STEP_LABELS[s]}</span>
			{#if i < DOMAIN_STEPS.length - 1}
				<span class="dw-line"></span>
			{/if}
		</button>
	{/each}
</nav>
