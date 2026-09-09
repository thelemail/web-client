<script lang="ts">
	import Region from '$core/settings/sections/Region.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Localization & region</title></svelte:head>

<Region s={settingsDraft.s} set={settingsDraft.set} />
