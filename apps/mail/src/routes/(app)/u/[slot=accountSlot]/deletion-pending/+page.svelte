<script lang="ts">
	import { goto } from '$app/navigation';
	import DeletionPending from '$core/lifecycle/DeletionPending.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';

	let { data } = $props();

	$effect(() => {
		if (!auth.deletionFor(data.accountId)) void goto(`/u/${data.slot}/mail/inbox`);
	});

	async function signedOut() {
		const remaining = accounts.list[0];
		if (remaining) {
			auth.activate(remaining.accountId);
			await goto(`/u/${remaining.slot}/mail/inbox`);
		} else {
			await goto('/login');
		}
	}
</script>

<DeletionPending accountId={data.accountId} onKept={() => goto(`/u/${data.slot}/mail/inbox`)} onSignedOut={signedOut} />
