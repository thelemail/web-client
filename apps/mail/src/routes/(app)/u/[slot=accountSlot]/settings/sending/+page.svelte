<script lang="ts">
	import Sending from '$lib/settings/sections/Sending.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Composing & sending</title></svelte:head>

<Sending s={settingsDraft.s} set={settingsDraft.set} />
