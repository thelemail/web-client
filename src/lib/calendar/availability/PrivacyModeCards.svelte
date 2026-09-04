<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import Lock from '@lucide/svelte/icons/lock';
	import Users from '@lucide/svelte/icons/users';
	import { cal } from '../state.svelte';
	import type { PrivacyMode } from '../types';

	const MODES: {
		value: PrivacyMode;
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
			body: 'Details stay encrypted. Selected people and booking pages receive the minimum busy window needed to schedule.',
			facts: ['server reads: start, end', 'shared: busy window only'],
			tone: 'var(--brass-600)'
		},
		{
			value: 'shared',
			label: 'Shared',
			body: 'You disclose chosen fields on purpose — to members, to invitees, or to a booking page. Each field is listed before it is sent.',
			facts: ['server reads: start, end', 'shared: fields you name'],
			tone: 'var(--info-500)'
		}
	];

	const ICONS = { private: Lock, busy: Eye, shared: Users };
</script>

<div class="pcards">
	{#each MODES as mode (mode.value)}
		{@const Icon = ICONS[mode.value]}
		<button
			type="button"
			class="pcard"
			class:on={cal.privacyMode === mode.value}
			onclick={() => cal.setPrivacyMode(mode.value)}
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
