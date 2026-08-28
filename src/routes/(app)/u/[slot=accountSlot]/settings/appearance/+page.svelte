<script lang="ts">
	import Appearance from '$lib/settings/sections/Appearance.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Appearance</title></svelte:head>

<Appearance s={settingsDraft.s} set={settingsDraft.set} />
