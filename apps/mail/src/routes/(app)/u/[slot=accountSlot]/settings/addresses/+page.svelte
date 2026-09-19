<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Addresses from '$core/settings/sections/Addresses.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_addresses() })}</title></svelte:head>

<Addresses s={settingsDraft.s} set={settingsDraft.set} launch={settingsDraft.launch} />
