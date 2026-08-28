<script lang="ts">
	import Addresses from '$lib/settings/sections/Addresses.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Addresses</title></svelte:head>

<Addresses s={settingsDraft.s} set={settingsDraft.set} launch={settingsDraft.launch} />
