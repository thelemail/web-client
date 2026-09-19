<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Security from '$core/settings/sections/Security.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_security() })}</title></svelte:head>

<Security s={settingsDraft.s} set={settingsDraft.set} launch={settingsDraft.launch} />
