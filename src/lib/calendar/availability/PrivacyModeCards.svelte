<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import Lock from '@lucide/svelte/icons/lock';
	import Users from '@lucide/svelte/icons/users';
	import { accountSettings, type CalendarPrivacyDefault } from '$lib/stores/accountSettings.svelte';
	import { cal } from '../state.svelte';

	const MODES: {
		value: CalendarPrivacyDefault;
		label: string;
		body: string;
		facts: string[];
		tone: string;
	}[] = [
		{
			value: 'private',
			label: 'Private',
			body: 'Details and timing are encrypted. Reminders fire on your devices. No availability is published to anyone.',
			facts: ['server reads: nothing', 'reminders: local only'],
			tone: 'var(--pine-600)'
		},
		{
			value: 'busy',
			label: 'Busy-only',
			body: 'Details stay encrypted. Members of your workspace see the busy window so they can find a free slot, and nothing else.',
			facts: ['server reads: start, end', 'shared: busy window only'],
			tone: 'var(--brass-600)'
		},
		{
			value: 'shared',
			label: 'Shared',
			body: 'You disclose chosen fields on purpose — to members, or to invitees. Each field is listed before it is sent.',
			facts: ['server reads: start, end', 'shared: fields you name'],
			tone: 'var(--info-500)'
		}
	];

	const ICONS = { private: Lock, busy: Eye, shared: Users };

	const NOTE: Record<CalendarPrivacyDefault, string> = {
		private: 'New commitments default to Private',
		busy: 'New commitments default to Busy-only',
		shared: 'New commitments default to Shared — fields are named before sending'
	};

	async function choose(mode: CalendarPrivacyDefault) {
		try {
			await accountSettings.persistCalendar({ ...accountSettings.calendar, defaultPrivacy: mode });
			cal.notify(NOTE[mode]);
		} catch {
			cal.notify('Could not save the default');
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
				<Icon size={16} color={mode.tone} />{mode.label}
			</span>
			<span class="pc-d">{mode.body}</span>
			<span class="pc-f">
				{#each mode.facts as fact, i (fact)}{#if i}<br />{/if}{fact}{/each}
			</span>
		</button>
	{/each}
</div>
