<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import PrivacyChip from '../PrivacyChip.svelte';
	import { cal } from '../state.svelte';

	const KINDS = [
		{ key: 'e', name: 'Event', note: 'fixed commitment' },
		{ key: 't', name: 'Task', note: 'deadline · owner · estimate' },
		{ key: 'h', name: 'Hold', note: 'busy, no details' },
		{ key: 'p', name: 'Proposal', note: 'awaiting agreement' }
	];
</script>

<div class="legend">
	{#each KINDS as kind (kind.key)}
		<span class="lg"><i class="lg-sw {kind.key}"></i><b>{kind.name}</b> {kind.note}</span>
	{/each}
	<span class="lg-spacer"></span>
	<button type="button" class="ackbtn" onclick={() => (cal.fullDay = !cal.fullDay)}>
		<Clock size={13} />{cal.fullDay ? 'Hide 00:00 – 06:00' : 'Show 00:00 – 06:00'}
	</button>
	<PrivacyChip tone="busy" label="Busy-only mirroring on" />
</div>
