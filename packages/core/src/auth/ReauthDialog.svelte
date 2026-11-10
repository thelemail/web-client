<script lang="ts">
	import { onMount } from 'svelte';
	import { registerReauthHandler } from '$core/api/client';
	import { confirmAtAuth } from '$core/custody/unlock';
	import { auth } from '$core/stores/session.svelte';
	import { reauth } from './reauth.svelte';
	import ReauthPrompt from './ReauthPrompt.svelte';

	onMount(() => {
		registerReauthHandler((accountId) => (auth.mailOnlyFor(accountId) ? confirmAtAuth(accountId) : reauth.request(accountId)));
		return () => {
			registerReauthHandler(null);
			reauth.settle(false);
		};
	});
</script>

{#if reauth.accountId}
	{#key reauth.accountId}
		<ReauthPrompt accountId={reauth.accountId} />
	{/key}
{/if}
