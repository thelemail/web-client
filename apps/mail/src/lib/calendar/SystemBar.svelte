<script lang="ts">
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { cal } from './state.svelte';
	import { calendarStore } from './store.svelte';

	const count = $derived(calendarStore.pendingCount + calendarStore.blockedCount);
</script>

<div class="sysbar {cal.systemBarTone}">
	{#if !calendarStore.online}
		<CloudOff size={16} />
		<b>Offline.</b>
	{:else if calendarStore.blockedCount || calendarStore.halted}
		<TriangleAlert size={16} />
		<b>Needs attention.</b>
	{:else}
		<RefreshCw size={16} />
		<b>Syncing.</b>
	{/if}
	<span>{cal.systemBarText}</span>
	{#if count}
		<span class="sb-count">{count} queued</span>
	{/if}
	<div class="grow"></div>
	<button type="button" class="sb-a" onclick={() => (cal.dialog = 'sync')}>Review queue</button>
	{#if !calendarStore.online || calendarStore.halted}
		<button type="button" class="sb-a" onclick={() => calendarStore.flush()}>Retry now</button>
	{/if}
</div>
