<script lang="ts">
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Select from '../Select.svelte';
	import Seg from '../Seg.svelte';
	import Toggle from '../Toggle.svelte';
	import CardHead from '../CardHead.svelte';
	import type { SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<SecHead
	tag="04 — Reading & behaviour"
	title="Reading & behaviour"
	desc="When mail is marked read, what loads when you open a message, and how read receipts are handled."
/>

<div class="scard">
	<CardHead title="When you open a message" />
	<Row t="Mark as read">
		<Select
			value={s.markRead}
			options={['Immediately on open', 'After 2 seconds', 'After 5 seconds', 'Never automatically']}
			onChange={(v) => set('markRead', v)}
		/>
	</Row>
	<Row
		t="Remote images"
		d="Blocking protects your IP address and reading habits from senders. Load per-message when you choose."
	>
		<Seg
			value={s.images}
			options={[
				{ v: 'ask', l: 'Ask' },
				{ v: 'contacts', l: 'Contacts' },
				{ v: 'always', l: 'Always' }
			]}
			onChange={(v) => set('images', v)}
		/>
	</Row>
	<Row t="Default action on swipe">
		<Select
			value={s.swipe}
			options={['Archive', 'Delete', 'Mark read', 'Snooze']}
			onChange={(v) => set('swipe', v)}
		/>
	</Row>
</div>

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
