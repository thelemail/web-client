<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Account from '$core/settings/sections/Account.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_account() })}</title></svelte:head>

<Account launch={settingsDraft.launch} />
