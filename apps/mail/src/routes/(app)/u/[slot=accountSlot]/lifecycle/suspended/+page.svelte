<script lang="ts">
	import { goto } from '$app/navigation';
	import '$lib/lifecycle/lifecycle.css';
	import SuspendedScreen from '$lib/lifecycle/SuspendedScreen.svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);

	$effect(() => {
		if (lifecycle.stage !== 'suspended') void goto(`/u/${slot}/mail/inbox`);
	});
</script>

<svelte:head>
	<title>Thelemail — Mailbox suspended</title>
</svelte:head>

<SuspendedScreen {ctx} />
