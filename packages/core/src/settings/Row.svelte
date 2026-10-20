<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		t: string;
		titleSnippet?: Snippet;
		d?: string;
		descSnippet?: Snippet;
		col?: boolean;
		children?: Snippet;
	}

	let { t, titleSnippet, d, descSnippet, col = false, children }: Props = $props();
</script>

<div class="setrow" class:col>
	<div class="info">
		<div class="t">{#if titleSnippet}{@render titleSnippet()}{:else}{t}{/if}</div>
		{#if descSnippet}
			<div class="d">{@render descSnippet()}</div>
		{:else if d}
			<div class="d">{d}</div>
		{/if}
	</div>
	{#if children}<div class="ctl">{@render children()}</div>{/if}
</div>
