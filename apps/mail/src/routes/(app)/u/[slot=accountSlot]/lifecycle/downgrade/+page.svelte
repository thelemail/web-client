<script lang="ts">
	import { onMount } from 'svelte';
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import DowngradeConfirm from '$core/lifecycle/DowngradeConfirm.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';

	let { data } = $props();
	const slot = $derived(data.slot);

	onMount(() => {
		if (auth.accountId && !workspaces.workspace) void workspaces.load(auth.accountId);
	});
</script>

<svelte:head>
	<title>Thelemail — Move to the free plan</title>
</svelte:head>

<LcShell badge={{ label: 'Change plan', sev: 'warn' }} backHref={`/u/${slot}/mail/inbox`}>
	<DowngradeConfirm />
</LcShell>
