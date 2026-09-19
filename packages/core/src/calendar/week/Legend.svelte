<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import { m } from '$paraglide/messages.js';
	import PrivacyChip from '../PrivacyChip.svelte';
	import { cal } from '../state.svelte';

	const KINDS = [
		{ key: 'e', name: () => m.cal_legend_event(), note: () => m.cal_legend_event_note() },
		{ key: 't', name: () => m.cal_legend_task(), note: () => m.cal_legend_task_note() },
		{ key: 'h', name: () => m.cal_legend_hold(), note: () => m.cal_legend_hold_note() }
	];

	const chip = $derived(
		accountSettings.calendar.defaultPrivacy === 'private'
			? { tone: 'private' as const, label: m.cal_legend_default_private() }
			: accountSettings.calendar.defaultPrivacy === 'shared'
				? { tone: 'external' as const, label: m.cal_legend_default_shared() }
				: { tone: 'busy' as const, label: m.cal_legend_default_busy() }
	);
</script>

<div class="legend">
	{#each KINDS as kind (kind.key)}
		<span class="lg"><i class="lg-sw {kind.key}"></i><b>{kind.name()}</b> {kind.note()}</span>
	{/each}
	<span class="lg-spacer"></span>
	<button type="button" class="ackbtn" onclick={() => (cal.fullDay = !cal.fullDay)}>
		<Clock size={13} />{cal.fullDay ? m.cal_legend_hide_early() : m.cal_legend_show_midnight()}
	</button>
	<PrivacyChip tone={chip.tone} label={chip.label} />
</div>
