<script lang="ts">
	import CloudOff from '@lucide/svelte/icons/cloud-off';
	import { cal } from './state.svelte';
</script>

<div class="sysbar warn">
	<CloudOff size={16} />
	<b>Offline.</b>
	<span>Creating and editing still work. Invitations leave when you reconnect.</span>
	<span class="sb-count">3 queued</span>
	<div class="grow"></div>
	<button type="button" class="sb-a" onclick={() => (cal.dialog = 'sync')}>Review queue</button>
	<button type="button" class="sb-a" onclick={() => cal.toggleOffline()}>Reconnect</button>
</div>
