<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { lifecycle } from './lifecycle.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { entryPointVisible, scheduledLine } from './downgrade';
	import GraceBanner from './GraceBanner.svelte';

	const slot = $derived(page.params.slot ?? '0');
	const stage = $derived(lifecycle.stage);
	const ctx = $derived(lifecycle.context);
	const canMoveToFree = $derived(
		workspaces.isOwner(auth.accountId) && entryPointVisible(billing.subscription)
	);
	const scheduled = $derived(scheduledLine(billing.subscription));

	function toRestore(origin: 'grace' | 'suspended') {
		lifecycle.markRestoreOrigin(origin);
		void goto(`/u/${slot}/lifecycle/restore`);
	}
</script>

{#if stage === 'grace'}
	<GraceBanner
		{ctx}
		{scheduled}
		onRestore={() => toRestore('grace')}
		onExport={() => void goto(`/u/${slot}/lifecycle/export`)}
		onDowngrade={canMoveToFree && !scheduled
			? () => void goto(`/u/${slot}/lifecycle/downgrade`)
			: undefined}
	/>
{/if}
