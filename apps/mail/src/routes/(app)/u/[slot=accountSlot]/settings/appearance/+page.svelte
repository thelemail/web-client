<script lang="ts">
	import Appearance from '$core/settings/sections/Appearance.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Appearance</title></svelte:head>

<Appearance s={settingsDraft.s} set={settingsDraft.set} />
