<script lang="ts">
	import type { Snippet } from 'svelte';
	import { glueTrailing, richSegments } from '$core/i18n/rich';

	let {
		text,
		past = false,
		lead = false,
		slots = {}
	}: { text: string; past?: boolean; lead?: boolean; slots?: Record<string, Snippet<[string]>> } = $props();

	const segments = $derived(glueTrailing(richSegments(text)));
</script>

{lead ? ' ' : ''}<span class:past
	>{#each segments as seg, i (i)}{#if seg.tag && slots[seg.tag]}{#if seg.tail}<span class="sp-glue"
					>{@render slots[seg.tag](seg.text)}{seg.tail}</span
				>{:else}{@render slots[seg.tag](seg.text)}{/if}{:else}{seg.text}{seg.tail ?? ''}{/if}{/each}</span
>
