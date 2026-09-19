<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Notifications from '$core/settings/sections/Notifications.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_notify() })}</title></svelte:head>

<Notifications s={settingsDraft.s} set={settingsDraft.set} />
