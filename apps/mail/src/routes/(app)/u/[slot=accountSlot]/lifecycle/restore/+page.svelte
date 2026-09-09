<script lang="ts">
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import Reactivation from '$core/lifecycle/Reactivation.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';

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
