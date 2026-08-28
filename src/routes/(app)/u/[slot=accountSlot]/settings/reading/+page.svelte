<script lang="ts">
	import Reading from '$lib/settings/sections/Reading.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Reading & behaviour</title></svelte:head>

<Reading s={settingsDraft.s} set={settingsDraft.set} />
