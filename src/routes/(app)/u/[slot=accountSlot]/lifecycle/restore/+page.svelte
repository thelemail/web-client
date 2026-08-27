<script lang="ts">
	import LcShell from '$lib/lifecycle/LcShell.svelte';
	import Reactivation from '$lib/lifecycle/Reactivation.svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);
</script>

<svelte:head>
	<title>Thelemail — Restore your account</title>
</svelte:head>

<LcShell badge={{ label: 'Restore' }} backHref={`/u/${slot}/mail/inbox`}>
	<Reactivation {ctx} />
</LcShell>
