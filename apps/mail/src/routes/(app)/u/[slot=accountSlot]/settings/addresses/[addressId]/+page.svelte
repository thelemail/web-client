<script lang="ts">
	import { page } from '$app/state';
	import AddressDetail from '$core/settings/sections/AddressDetail.svelte';

	const addressId = $derived(page.params.addressId ?? '');
</script>

<svelte:head><title>Thelemail — Address</title></svelte:head>

<AddressDetail {addressId} />
