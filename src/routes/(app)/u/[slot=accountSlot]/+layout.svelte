<script lang="ts">
	import { onMount } from 'svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';
	import { realtime } from '$lib/realtime/realtime.svelte';

	let { children, data } = $props();

	$effect(() => {
		lifecycle.setAccount(data.accountId);
	});

	onMount(() => realtime.start());
</script>

{@render children()}
