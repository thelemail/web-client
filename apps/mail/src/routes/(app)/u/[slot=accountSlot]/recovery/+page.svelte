<script lang="ts">
	import { page } from '$app/state';
	import RecoveryStart from '$core/recovery/RecoveryStart.svelte';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();

	const returnTo = $derived(resolveReturnTo(page.url.searchParams.get('redirect'), data.slot));
</script>

<svelte:head>
	<title>{m.recovery_start_page_title()}</title>
</svelte:head>

{#key data.accountId}
	<RecoveryStart accountId={data.accountId} {returnTo} />
{/key}
