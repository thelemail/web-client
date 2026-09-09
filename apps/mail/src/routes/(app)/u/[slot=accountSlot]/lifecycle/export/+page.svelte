<script lang="ts">
	import LcShell from '$lib/lifecycle/LcShell.svelte';
	import ExportCenter from '$lib/lifecycle/ExportCenter.svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);
</script>

<svelte:head>
	<title>Thelemail — Export your data</title>
</svelte:head>

<LcShell badge={{ label: 'Export' }} backHref={`/u/${slot}/mail/inbox`}>
	<ExportCenter {ctx} />
</LcShell>
