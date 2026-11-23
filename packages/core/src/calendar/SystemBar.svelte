<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowsRotate,
		faCloudSlash,
		faTriangleExclamation
	} from '@fortawesome/pro-regular-svg-icons';
	import { m } from '$paraglide/messages.js';
	import { cal } from './state.svelte';
	import { calendarStore } from './store.svelte';

	const count = $derived(calendarStore.pendingCount + calendarStore.blockedCount);
</script>

<div class="sysbar {cal.systemBarTone}">
	{#if !calendarStore.online}
		<Icon icon={faCloudSlash} size={16} />
		<b>{m.cal_sysbar_offline()}</b>
	{:else if calendarStore.blockedCount || calendarStore.halted}
		<Icon icon={faTriangleExclamation} size={16} />
		<b>{m.cal_sysbar_attention()}</b>
	{:else}
		<Icon icon={faArrowsRotate} size={16} />
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
