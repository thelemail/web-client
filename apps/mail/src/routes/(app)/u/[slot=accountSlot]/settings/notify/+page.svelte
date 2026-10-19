<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Notifications from '$core/settings/sections/Notifications.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_notify() })}</title></svelte:head>

<Notifications />
