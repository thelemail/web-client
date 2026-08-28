<script lang="ts">
	import CustomDomains from '$lib/settings/sections/CustomDomains.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Custom domains</title></svelte:head>

<CustomDomains launch={settingsDraft.launch} />
