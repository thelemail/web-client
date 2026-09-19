<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import BlockedSenders from '$core/settings/sections/BlockedSenders.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_blocked() })}</title></svelte:head>

<BlockedSenders />
