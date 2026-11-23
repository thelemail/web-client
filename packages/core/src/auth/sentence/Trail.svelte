<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faCheck } from '@fortawesome/pro-regular-svg-icons';
	import { m } from '$paraglide/messages.js';

	let { items, current }: { items: string[]; current: number } = $props();
</script>

<ol class="sp-trail" aria-label={m.auth_sentence_progress({ step: Math.min(current + 1, items.length), total: items.length })}>
	{#each items as item, i (i)}
		<li class:done={i < current} class:cur={i === current} aria-current={i === current ? 'step' : undefined}>
			{#if i < current}<Icon icon={faCheck} size={12} />{/if}{item}
		</li>
	{/each}
</ol>
