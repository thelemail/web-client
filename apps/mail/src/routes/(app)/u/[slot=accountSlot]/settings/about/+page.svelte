<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import About from '$core/settings/sections/About.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_about() })}</title></svelte:head>

<About />
