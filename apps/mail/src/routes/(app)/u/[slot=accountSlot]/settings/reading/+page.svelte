<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Reading from '$core/settings/sections/Reading.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_reading() })}</title></svelte:head>

<Reading s={settingsDraft.s} set={settingsDraft.set} />
