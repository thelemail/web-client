<script lang="ts">
	import Account from '$core/settings/sections/Account.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Account & plan</title></svelte:head>

<Account launch={settingsDraft.launch} />
