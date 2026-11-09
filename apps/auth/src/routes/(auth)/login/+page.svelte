<script lang="ts">
	import { goto } from '$app/navigation';
	import LoginFlow from '$core/auth/LoginFlow.svelte';
	import { requestPersistence } from '$core/auth/storage-persistence';
	import { hasPendingAuthorize } from '$core/producthandoff/authorize';

	async function afterSignIn(slot: number) {
		await requestPersistence();
		await goto(hasPendingAuthorize() ? '/authorize' : `/u/${slot}`);
	}
</script>

<LoginFlow {afterSignIn} />
