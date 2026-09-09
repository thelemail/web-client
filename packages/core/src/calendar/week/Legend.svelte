<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import PrivacyChip from '../PrivacyChip.svelte';
	import { cal } from '../state.svelte';

	const KINDS = [
		{ key: 'e', name: 'Event', note: 'fixed commitment' },
		{ key: 't', name: 'Task', note: 'deadline · owner · estimate' },
		{ key: 'h', name: 'Hold', note: 'busy, no details' }
	];

	const chip = $derived(
		accountSettings.calendar.defaultPrivacy === 'private'
			? { tone: 'private' as const, label: 'New items default to Private' }
			: accountSettings.calendar.defaultPrivacy === 'shared'
				? { tone: 'external' as const, label: 'New items default to Shared' }
				: { tone: 'busy' as const, label: 'New items default to Busy-only' }
	);
</script>

<div class="legend">
	{#each KINDS as kind (kind.key)}
		<span class="lg"><i class="lg-sw {kind.key}"></i><b>{kind.name}</b> {kind.note}</span>
	{/each}
	<span class="lg-spacer"></span>
	<button type="button" class="ackbtn" onclick={() => (cal.fullDay = !cal.fullDay)}>
		<Clock size={13} />{cal.fullDay ? 'Hide the early hours' : 'Show from midnight'}
	</button>
	<PrivacyChip tone={chip.tone} label={chip.label} />
</div>
