<script lang="ts">
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import Cancellation from '$core/lifecycle/Cancellation.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';

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
