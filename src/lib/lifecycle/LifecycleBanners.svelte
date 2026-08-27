<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { lifecycle } from './lifecycle.svelte';
	import TrialBanner from './TrialBanner.svelte';
	import GraceBanner from './GraceBanner.svelte';
	import TimelineSheet from './TimelineSheet.svelte';

	const slot = $derived(page.params.slot ?? '0');
	const stage = $derived(lifecycle.stage);
	const ctx = $derived(lifecycle.context);

	let dismissed = $state(false);
	let sheetOpen = $state(false);

	$effect(() => {
		lifecycle.stage;
		dismissed = false;
		sheetOpen = false;
	});

	function toRestore(origin: 'grace' | 'suspended') {
		lifecycle.markRestoreOrigin(origin);
		void goto(`/u/${slot}/lifecycle/restore`);
	}
</script>

{#if stage === 'trial-ending' && !dismissed}
	<TrialBanner {ctx} onSee={() => (sheetOpen = true)} onDismiss={() => (dismissed = true)} />
{:else if stage === 'grace'}
	<GraceBanner
		{ctx}
		onRestore={() => toRestore('grace')}
		onExport={() => void goto(`/u/${slot}/lifecycle/export`)}
	/>
{/if}

{#if stage === 'trial-ending' && sheetOpen}
	<TimelineSheet
		{ctx}
		onClose={() => (sheetOpen = false)}
		onChoose={() => {
			sheetOpen = false;
			void goto(`/u/${slot}/billing/choose`);
		}}
	/>
{/if}
