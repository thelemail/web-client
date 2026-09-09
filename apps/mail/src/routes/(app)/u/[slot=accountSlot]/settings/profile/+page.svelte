<script lang="ts">
	import Profile from '$lib/settings/sections/Profile.svelte';
	import { settingsDraft } from '$lib/stores/settingsDraft.svelte';
	import { auth } from '$lib/stores/auth.svelte';
</script>

<svelte:head><title>Thelemail — Profile</title></svelte:head>

<Profile
	email={auth.email ?? ''}
	bind:dirty={settingsDraft.profileDirty}
	bind:save={settingsDraft.profileSave}
	onEdit={settingsDraft.scheduleAutosave}
/>
