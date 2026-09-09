<script lang="ts">
	import Check from '@lucide/svelte/icons/check';

	let {
		step,
		labels = ['Address', 'Password', 'Done'],
		compact = false
	}: { step: number; labels?: string[]; compact?: boolean } = $props();

	const nodes = $derived(labels.map((lbl, i) => ({ n: i + 1, lbl })));
</script>

<div class="stepper" class:compact={compact || labels.length > 3}>
	{#each nodes as nd, i (nd.n)}
		{#if i > 0}
			<span class="seg" class:done={step >= i}></span>
		{/if}
		<div class="node" class:cur={step === i} class:done={step > i}>
			<span class="dot">
				{#if step > i}
					<Check size={13} strokeWidth={2} />
				{:else}
					{nd.n}
				{/if}
			</span>
			<span class="lbl">{nd.lbl}</span>
		</div>
	{/each}
</div>
