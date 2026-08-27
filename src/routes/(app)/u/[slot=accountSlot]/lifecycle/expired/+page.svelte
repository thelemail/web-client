<script lang="ts">
	import { goto } from '$app/navigation';
	import LcShell from '$lib/lifecycle/LcShell.svelte';
	import ExpiryScreen from '$lib/lifecycle/ExpiryScreen.svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);
	const endedLabel = $derived(ctx.cohort === 'ex_paid' ? 'Subscription ended' : 'Trial ended');

	$effect(() => {
		if (lifecycle.stage !== 'expired') void goto(`/u/${slot}/mail/inbox`);
	});
</script>

<svelte:head>
	<title>Thelemail — {endedLabel}</title>
</svelte:head>

<LcShell badge={{ label: endedLabel, sev: 'warn' }}>
	<ExpiryScreen {ctx} />
</LcShell>
