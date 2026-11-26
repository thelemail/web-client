<script lang="ts">
	import { m } from '$paraglide/messages.js';

	let { total, current, fraction = 1 }: { total: number; current: number; fraction?: number } = $props();

	const fill = $derived(Math.max(0, Math.min(1, fraction)));
</script>

<ol class="af-steps" aria-label={m.auth_step_of({ step: Math.min(current + 1, total), total })}>
	{#each { length: total }, i (i)}
		<li class:done={i < current} class:cur={i === current} style:--fill={i === current ? fill : undefined}></li>
	{/each}
</ol>
