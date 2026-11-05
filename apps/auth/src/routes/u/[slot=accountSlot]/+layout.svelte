<script lang="ts">
	import '$core/settings/settings.css';
	import { auth } from '$core/stores/session.svelte';

	let { children, data } = $props();

	$effect(() => {
		if (auth.vaultUnlockedFor(data.accountId) && !auth.sessionLost(data.accountId)) return;
		window.location.assign(`/login?slot=${data.slot}`);
	});
</script>

{@render children()}
