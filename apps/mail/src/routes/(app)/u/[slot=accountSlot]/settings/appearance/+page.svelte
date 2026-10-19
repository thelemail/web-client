<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Appearance from '$core/settings/sections/Appearance.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_appearance() })}</title></svelte:head>

<Appearance />
