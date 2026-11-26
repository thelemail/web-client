<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Status from '$core/auth/form/Status.svelte';
	import { hasPendingAuthorize } from '$core/producthandoff/pending';
	import { mailStartUrl } from '$core/products';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();

	onMount(() => {
		if (hasPendingAuthorize()) void goto('/authorize', { replace: true });
		else window.location.replace(mailStartUrl(data.accountId, data.slot));
	});
</script>

<div class="af-wait" aria-busy="true">
	<Status tone="busy">{m.handoff_opening()}</Status>
</div>
