<script lang="ts">
	import type { Snippet } from 'svelte';
	import { richSegments } from './rich';

	let { text, tags }: { text: string; tags: Record<string, Snippet<[string]>> } = $props();

	const segments = $derived(richSegments(text));
</script>

{#each segments as segment, i (i)}{#if segment.tag && tags[segment.tag]}{@render tags[segment.tag](segment.text)}{:else}{segment.text}{/if}{/each}
