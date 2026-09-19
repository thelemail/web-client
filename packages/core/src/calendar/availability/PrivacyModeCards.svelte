<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import Lock from '@lucide/svelte/icons/lock';
	import Users from '@lucide/svelte/icons/users';
	import { accountSettings, type CalendarPrivacyDefault } from '$core/stores/accountSettings.svelte';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';

	const MODES: {
		value: CalendarPrivacyDefault;
		label: () => string;
		body: () => string;
		facts: () => string[];
		tone: string;
	}[] = [
		{
			value: 'private',
			label: () => m.cal_privacy_private(),
			body: () => m.cal_privacy_private_body(),
			facts: () => [m.cal_privacy_private_fact_server(), m.cal_privacy_private_fact_reminders()],
			tone: 'var(--pine-600)'
		},
		{
			value: 'busy',
			label: () => m.cal_privacy_busy(),
			body: () => m.cal_privacy_busy_body(),
			facts: () => [m.cal_privacy_busy_fact_server(), m.cal_privacy_busy_fact_shared()],
			tone: 'var(--brass-600)'
		},
		{
			value: 'shared',
			label: () => m.cal_privacy_shared(),
			body: () => m.cal_privacy_shared_body(),
			facts: () => [m.cal_privacy_shared_fact_server(), m.cal_privacy_shared_fact_shared()],
			tone: 'var(--info-500)'
		}
	];

	const ICONS = { private: Lock, busy: Eye, shared: Users };

	const NOTE: Record<CalendarPrivacyDefault, () => string> = {
		private: () => m.cal_privacy_note_private(),
		busy: () => m.cal_privacy_note_busy(),
		shared: () => m.cal_privacy_note_shared()
	};

	async function choose(mode: CalendarPrivacyDefault) {
		try {
			await accountSettings.persistCalendar({ ...accountSettings.calendar, defaultPrivacy: mode });
			cal.notify(NOTE[mode]());
		} catch {
			cal.notify(m.cal_privacy_save_failed());
		}
	}
</script>

<div class="pcards">
	{#each MODES as mode (mode.value)}
		{@const Icon = ICONS[mode.value]}
		<button
			type="button"
			class="pcard"
			class:on={accountSettings.calendar.defaultPrivacy === mode.value}
			onclick={() => choose(mode.value)}
		>
			<span class="pc-t" style:--icon-tone={mode.tone}>
				<Icon size={16} color={mode.tone} />{mode.label()}
			</span>
			<span class="pc-d">{mode.body()}</span>
			<span class="pc-f">
				{#each mode.facts() as fact, i (fact)}{#if i}<br />{/if}{fact}{/each}
			</span>
		</button>
	{/each}
</div>
