<script lang="ts">
	import Notifications from '$lib/settings/sections/Notifications.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Notifications</title></svelte:head>

<Notifications s={settingsDraft.s} set={settingsDraft.set} />
