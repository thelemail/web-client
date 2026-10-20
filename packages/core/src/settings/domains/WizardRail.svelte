<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Clock from '@lucide/svelte/icons/clock';
	import { DOMAIN_STEPS, STEP_LABELS, type DomainStep } from './steps';
	import { m } from '$paraglide/messages.js';

	interface Props {
		current: DomainStep;
		done: (s: DomainStep) => boolean;
		reachable: (s: DomainStep) => boolean;
		running?: (s: DomainStep) => boolean;
		onSelect: (s: DomainStep) => void;
	}

	let { current, done, reachable, running = () => false, onSelect }: Props = $props();
</script>

<nav class="dw-rail" aria-label={m.settings_domains_rail_aria()}>
	{#each DOMAIN_STEPS as s, i (s)}
		<button
			type="button"
			class="dw-step"
			class:on={current === s}
			class:done={done(s)}
			class:run={running(s) && !done(s)}
			aria-current={current === s ? 'step' : undefined}
			disabled={!reachable(s)}
			onclick={() => onSelect(s)}
		>
			<span class="dw-dot" aria-hidden="true">
				{#if done(s)}<Check size={13} strokeWidth={2} />{:else if running(s)}<Clock size={13} strokeWidth={2} />{:else}{i + 1}{/if}
			</span>
			<span class="dw-lbl">{STEP_LABELS[s]()}</span>
			{#if done(s)}
				<span class="sr-only">{m.settings_step_completed()}</span>
			{:else if running(s)}
				<span class="sr-only">{m.settings_step_running()}</span>
			{/if}
			{#if i < DOMAIN_STEPS.length - 1}
				<span class="dw-line"></span>
			{/if}
		</button>
	{/each}
</nav>
