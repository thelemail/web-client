<script lang="ts">
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Select from '../Select.svelte';
	import Toggle from '../Toggle.svelte';
	import CardHead from '../CardHead.svelte';
	import { UNRELEASED, type SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<SecHead desc="When mail is marked read." />

<div class="scard">
	<CardHead title="When you open a message" />
	<Row t="Mark as read">
		<Select
			value={s.markRead}
			options={['Immediately on open', 'After 2 seconds', 'After 5 seconds', 'Never automatically']}
			onChange={(v) => set('markRead', v)}
		/>
	</Row>
	{#if UNRELEASED.swipeAction}
		<Row t="Default action on swipe">
			<Select
				value={s.swipe}
				options={['Archive', 'Delete', 'Mark read', 'Snooze']}
				onChange={(v) => set('swipe', v)}
			/>
		</Row>
	{/if}
</div>

{#if UNRELEASED.requestReceipts || UNRELEASED.respondReceipts}
	<div class="scard">
		<CardHead icon={MailCheck} title="Read receipts" />
		<Row t="Request read receipts" d="Off by respect for the reader. We never track silently.">
			<Toggle on={s.requestReceipts} onChange={(v) => set('requestReceipts', v)} />
		</Row>
		<Row t="Respond to receipt requests">
			<Select
				value={s.sendReceipts}
				options={['Always ask me', 'Always send', 'Never send']}
				onChange={(v) => set('sendReceipts', v)}
			/>
		</Row>
	</div>
{/if}
