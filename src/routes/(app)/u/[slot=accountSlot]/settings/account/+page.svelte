<script lang="ts">
	import Account from '$lib/settings/sections/Account.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Account & plan</title></svelte:head>

<Account launch={settingsDraft.launch} />
