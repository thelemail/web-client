<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import HandoffCard from '$core/auth/form/HandoffCard.svelte';
	import { orderFromQuery, startCheckout } from '$core/auth/register-checkout';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();

	function go() {
		const order = orderFromQuery(page.url.searchParams);
		if (order) void startCheckout(data.slot, order);
		else void goto(`/u/${data.slot}/billing/choose`, { replace: true });
	}

	onMount(go);
</script>

<AuthShell strip={false}>
	<div class="card">
		<HandoffCard
			title={m.handoff_checkout_title()}
			lede={m.handoff_checkout_lede()}
			to={m.handoff_checkout_host()}
			retry={go}
		/>
	</div>
</AuthShell>
