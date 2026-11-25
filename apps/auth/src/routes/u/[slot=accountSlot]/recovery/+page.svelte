<script lang="ts">
	import RecoveryStart from '$core/recovery/RecoveryStart.svelte';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();
</script>

<svelte:head>
	<title>{m.recovery_start_page_title()}</title>
</svelte:head>

{#key data.accountId}
	<RecoveryStart accountId={data.accountId} returnTo={`/u/${data.slot}/mail`} />
{/key}
