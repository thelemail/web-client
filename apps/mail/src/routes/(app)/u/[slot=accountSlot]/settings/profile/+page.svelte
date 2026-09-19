<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Profile from '$core/settings/sections/Profile.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
	import { auth } from '$core/stores/auth.svelte';
</script>

<svelte:head><title>{m.settings_page_title({ page: m.settings_nav_profile() })}</title></svelte:head>

<Profile
	email={auth.email ?? ''}
	bind:dirty={settingsDraft.profileDirty}
	bind:save={settingsDraft.profileSave}
	onEdit={settingsDraft.scheduleAutosave}
/>
