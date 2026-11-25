<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Status from '$core/auth/sentence/Status.svelte';
	import { orderFromQuery, startCheckout } from '$core/auth/register-checkout';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();

	onMount(() => {
		const order = orderFromQuery(page.url.searchParams);
		if (order) void startCheckout(data.slot, order);
		else void goto(`/u/${data.slot}/billing/choose`, { replace: true });
	});
</script>

<div class="sp" aria-busy="true">
	<Status tone="busy">{m.common_loading()}</Status>
</div>
