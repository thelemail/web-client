<script lang="ts">
	import Profile from '$core/settings/sections/Profile.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
	import { auth } from '$core/stores/auth.svelte';
</script>

<svelte:head><title>Thelemail — Profile</title></svelte:head>

<Profile
	email={auth.email ?? ''}
	bind:dirty={settingsDraft.profileDirty}
	bind:save={settingsDraft.profileSave}
	onEdit={settingsDraft.scheduleAutosave}
/>
