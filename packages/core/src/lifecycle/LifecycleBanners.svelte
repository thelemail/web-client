<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { lifecycle } from './lifecycle.svelte';
	import GraceBanner from './GraceBanner.svelte';

	const slot = $derived(page.params.slot ?? '0');
	const stage = $derived(lifecycle.stage);
	const ctx = $derived(lifecycle.context);

	function toRestore(origin: 'grace' | 'suspended') {
		lifecycle.markRestoreOrigin(origin);
		void goto(`/u/${slot}/lifecycle/restore`);
	}
</script>

{#if stage === 'grace'}
	<GraceBanner
		{ctx}
		onRestore={() => toRestore('grace')}
		onExport={() => void goto(`/u/${slot}/lifecycle/export`)}
	/>
{/if}
