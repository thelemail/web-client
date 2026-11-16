<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Search from '$core/settings/sections/Search.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_search() })}</title></svelte:head>

<Search />
