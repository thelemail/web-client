<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import RegisterFlow from '$core/auth/RegisterFlow.svelte';
	import { checkoutRoute, type RegisterCheckout } from '$core/auth/register-checkout';
	import { requestPersistence } from '$core/auth/storage-persistence';
	import { hasPendingAuthorize, setAuthorizeRoute } from '$core/producthandoff/pending';
	import { productTarget, registerStartUrl } from '$core/products';
	import { auth } from '$core/stores/session.svelte';

	let ready = $state(false);

	onMount(() => {
		if (hasPendingAuthorize() || !productTarget('app')) ready = true;
		else window.location.replace(registerStartUrl());
	});

	async function afterRegister(slot: number) {
		await requestPersistence();
		await goto(auth.recoveryEnabled === false ? `/u/${slot}/recovery` : `/u/${slot}/mail`);
	}

	async function checkout(slot: number, order: RegisterCheckout) {
		setAuthorizeRoute(checkoutRoute(slot, order));
		await afterRegister(slot);
	}
</script>

{#if ready}
	<RegisterFlow {afterRegister} {checkout} remember />
{/if}
