<script lang="ts">
	import { goto } from '$app/navigation';
	import RegisterFlow from '$core/auth/RegisterFlow.svelte';
	import { requestPersistence } from '$core/auth/storage-persistence';
	import { appOrigin } from '$core/products';

	async function afterRegister(slot: number) {
		await requestPersistence();
		await goto(`/u/${slot}`);
	}

	async function checkout() {
		window.location.assign(`${appOrigin()}/login`);
	}
</script>

<RegisterFlow {afterRegister} {checkout} />
