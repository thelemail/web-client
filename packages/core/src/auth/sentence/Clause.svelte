<script lang="ts">
	import type { Snippet } from 'svelte';
	import Rich from '$core/i18n/Rich.svelte';

	let {
		text,
		past = false,
		slots = {}
	}: { text: string; past?: boolean; slots?: Record<string, Snippet<[string]>> } = $props();
</script>

<span class:past><Rich {text} tags={slots} /></span>
