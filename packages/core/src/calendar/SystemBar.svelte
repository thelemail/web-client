<script lang="ts">
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { m } from '$paraglide/messages.js';
	import { cal } from './state.svelte';
	import { calendarStore } from './store.svelte';

	const count = $derived(calendarStore.pendingCount + calendarStore.blockedCount);
</script>

<div class="sysbar {cal.systemBarTone}">
	{#if !calendarStore.online}
		<CloudOff size={16} />
		<b>{m.cal_sysbar_offline()}</b>
	{:else if calendarStore.blockedCount || calendarStore.halted}
		<TriangleAlert size={16} />
		<b>{m.cal_sysbar_attention()}</b>
	{:else}
		<RefreshCw size={16} />
		<b>{m.cal_sysbar_syncing()}</b>
	{/if}
	<span>{cal.systemBarText}</span>
	{#if count}
		<span class="sb-count">{m.cal_sysbar_queued({ count })}</span>
	{/if}
	<div class="grow"></div>
	<button type="button" class="sb-a" onclick={() => (cal.dialog = 'sync')}>{m.cal_sysbar_review_queue()}</button>
	{#if !calendarStore.online || calendarStore.halted}
		<button type="button" class="sb-a" onclick={() => calendarStore.flush()}>{m.cal_sysbar_retry_now()}</button>
	{/if}
</div>
