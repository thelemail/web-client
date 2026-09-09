<script lang="ts">
	import { goto } from '$app/navigation';
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import ExpiryScreen from '$core/lifecycle/ExpiryScreen.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);

	$effect(() => {
		if (lifecycle.stage !== 'expired') void goto(`/u/${slot}/mail/inbox`);
	});
</script>

<svelte:head>
	<title>Thelemail — Subscription ended</title>
</svelte:head>

<LcShell badge={{ label: 'Subscription ended', sev: 'warn' }}>
	<ExpiryScreen {ctx} />
</LcShell>
