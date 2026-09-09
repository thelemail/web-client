<script lang="ts">
	import Security from '$lib/settings/sections/Security.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Security & privacy</title></svelte:head>

<Security s={settingsDraft.s} set={settingsDraft.set} launch={settingsDraft.launch} />
