<script lang="ts">
	import { goto } from '$app/navigation';
	import DeletionPending from '$core/lifecycle/DeletionPending.svelte';
	import { hasPendingAuthorize } from '$core/producthandoff/pending';

	let { data } = $props();
</script>

<DeletionPending
	accountId={data.accountId}
	onKept={() => goto(hasPendingAuthorize() ? '/authorize' : `/u/${data.slot}/mail`)}
	onSignedOut={() => goto('/login')}
/>
