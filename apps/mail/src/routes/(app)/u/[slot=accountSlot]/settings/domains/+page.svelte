<script lang="ts">
	import CustomDomains from '$core/settings/sections/CustomDomains.svelte';
	import { m } from '$paraglide/messages.js';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_domains() })}</title></svelte:head>

<CustomDomains />
