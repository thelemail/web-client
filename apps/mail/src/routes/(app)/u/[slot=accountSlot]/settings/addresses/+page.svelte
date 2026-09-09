<script lang="ts">
	import Addresses from '$core/settings/sections/Addresses.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Addresses</title></svelte:head>

<Addresses s={settingsDraft.s} set={settingsDraft.set} launch={settingsDraft.launch} />
