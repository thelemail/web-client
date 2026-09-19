<script lang="ts">
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import Reactivation from '$core/lifecycle/Reactivation.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);
</script>

<svelte:head>
	<title>{m.lc_page_title_restore()}</title>
</svelte:head>

<LcShell badge={{ label: m.lc_badge_restore() }} backHref={`/u/${slot}/mail/inbox`}>
	<Reactivation {ctx} />
</LcShell>
