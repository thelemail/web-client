<script lang="ts">
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import ExportCenter from '$core/lifecycle/ExportCenter.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';

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
