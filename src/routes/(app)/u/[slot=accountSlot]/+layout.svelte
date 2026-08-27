<script lang="ts">
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';

	let { children, data } = $props();

	$effect(() => {
		lifecycle.setAccount(data.accountId);
	});
</script>

{@render children()}
