<script lang="ts">
	import Region from '$lib/settings/sections/Region.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Localization & region</title></svelte:head>

<Region s={settingsDraft.s} set={settingsDraft.set} />
