<script lang="ts">
	import { onMount } from 'svelte';
	import LcShell from '$core/lifecycle/LcShell.svelte';
	import DowngradeConfirm from '$core/lifecycle/DowngradeConfirm.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { m } from '$paraglide/messages.js';

	let { data } = $props();
	const slot = $derived(data.slot);

	onMount(() => {
		if (auth.accountId && !workspaces.workspace) void workspaces.load(auth.accountId);
	});
</script>

<svelte:head>
	<title>{m.lc_page_title_downgrade()}</title>
</svelte:head>

<LcShell badge={{ label: m.lc_badge_change_plan(), sev: 'warn' }} backHref={`/u/${slot}/mail/inbox`}>
	<DowngradeConfirm />
</LcShell>
