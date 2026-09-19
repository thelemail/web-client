<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Region from '$core/settings/sections/Region.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_page_region() })}</title></svelte:head>

<Region s={settingsDraft.s} set={settingsDraft.set} />
