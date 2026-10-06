<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Collections from '$core/settings/sections/Collections.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_collections() })}</title></svelte:head>

<Collections />
