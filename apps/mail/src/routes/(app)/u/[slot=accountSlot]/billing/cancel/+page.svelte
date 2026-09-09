<script lang="ts">
	import LcShell from '$lib/lifecycle/LcShell.svelte';
	import Cancellation from '$lib/lifecycle/Cancellation.svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);
</script>

<svelte:head>
	<title>Thelemail — Cancel plan</title>
</svelte:head>

<LcShell badge={{ label: 'Cancel' }} backHref={`/u/${slot}/mail/inbox`}>
	<Cancellation {ctx} />
</LcShell>
