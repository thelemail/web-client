<script lang="ts">
	import type { Snippet } from 'svelte';
	import Rich from '$core/i18n/Rich.svelte';

	let {
		text,
		past = false,
		lead = false,
		slots = {}
	}: { text: string; past?: boolean; lead?: boolean; slots?: Record<string, Snippet<[string]>> } = $props();
</script>

{lead ? ' ' : ''}<span class:past><Rich {text} tags={slots} /></span>
