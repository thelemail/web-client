<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { page } from '$app/state';
	import AddressDetail from '$core/settings/sections/AddressDetail.svelte';

	const addressId = $derived(page.params.addressId ?? '');
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_page_address() })}</title></svelte:head>

<AddressDetail {addressId} />
