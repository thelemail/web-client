<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Import from '$core/settings/sections/Import.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_import() })}</title></svelte:head>

<Import />
