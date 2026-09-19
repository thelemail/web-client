<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Sending from '$core/settings/sections/Sending.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_sending() })}</title></svelte:head>

<Sending s={settingsDraft.s} set={settingsDraft.set} />
