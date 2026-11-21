<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import { m } from '$paraglide/messages.js';

	let { items, current }: { items: string[]; current: number } = $props();
</script>

<ol class="sp-trail" aria-label={m.auth_sentence_progress({ step: Math.min(current + 1, items.length), total: items.length })}>
	{#each items as item, i (i)}
		<li class:done={i < current} class:cur={i === current} aria-current={i === current ? 'step' : undefined}>
			{#if i < current}<Check size={12} strokeWidth={2.4} />{/if}{item}
		</li>
	{/each}
</ol>
