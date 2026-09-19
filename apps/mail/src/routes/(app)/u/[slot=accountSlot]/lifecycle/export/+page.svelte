<script lang="ts">
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import ExportCenter from '$core/lifecycle/ExportCenter.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);
</script>

<svelte:head>
	<title>{m.lc_page_title_export()}</title>
</svelte:head>

<LcShell badge={{ label: m.lc_badge_export() }} backHref={`/u/${slot}/mail/inbox`}>
	<ExportCenter {ctx} />
</LcShell>
