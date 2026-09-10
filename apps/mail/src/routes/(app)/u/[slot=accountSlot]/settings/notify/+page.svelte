<script lang="ts">
	import Notifications from '$core/settings/sections/Notifications.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
</script>

<svelte:head><title>Thelemail — Notifications</title></svelte:head>

<Notifications s={settingsDraft.s} set={settingsDraft.set} />
