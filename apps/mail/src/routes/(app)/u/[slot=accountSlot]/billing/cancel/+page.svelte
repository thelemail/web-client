<script lang="ts">
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import Cancellation from '$core/lifecycle/Cancellation.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();
	const slot = $derived(data.slot);
	const ctx = $derived(lifecycle.context);
</script>

<svelte:head>
	<title>{m.billing_cancel_page_title()}</title>
</svelte:head>

<LcShell badge={{ label: m.billing_cancel_badge() }} backHref={`/u/${slot}/mail/inbox`}>
	<Cancellation {ctx} />
</LcShell>
