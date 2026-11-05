<script lang="ts">
	import { goto } from '$app/navigation';
	import LoginFlow from '$core/auth/LoginFlow.svelte';
	import { requestPersistence } from '$core/auth/storage-persistence';

	async function afterSignIn(slot: number) {
		await requestPersistence();
		await goto(`/u/${slot}`);
	}
</script>

<LoginFlow {afterSignIn} />
