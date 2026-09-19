<script lang="ts">
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Select from '../Select.svelte';
	import Toggle from '../Toggle.svelte';
	import CardHead from '../CardHead.svelte';
	import { UNRELEASED, type SettingsState } from '../data';
	import { MARK_READ_LABELS, SWIPE_LABELS } from '$core/stores/accountSettings.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();

	const RECEIPT_LABELS: Record<string, () => string> = {
		'Always ask me': () => m.settings_reading_receipts_ask(),
		'Always send': () => m.settings_reading_receipts_always(),
		'Never send': () => m.settings_reading_receipts_never()
	};

	const labelled = (labels: Record<string, () => string>) =>
		Object.entries(labels).map(([v, l]) => ({ v, l: l() }));
</script>

<SecHead desc={m.settings_reading_desc()} />

<div class="scard">
	<CardHead title={m.settings_reading_open_title()} />
	<Row t={m.settings_reading_mark_read()}>
		<Select
			value={s.markRead}
			options={labelled(MARK_READ_LABELS)}
			onChange={(v) => set('markRead', v)}
		/>
	</Row>
	{#if UNRELEASED.swipeAction}
		<Row t={m.settings_reading_swipe()}>
			<Select
				value={s.swipe}
				options={labelled(SWIPE_LABELS)}
				onChange={(v) => set('swipe', v)}
			/>
		</Row>
	{/if}
</div>

{#if UNRELEASED.requestReceipts || UNRELEASED.respondReceipts}
	<div class="scard">
		<CardHead icon={MailCheck} title={m.settings_reading_receipts_title()} />
		<Row t={m.settings_reading_receipts_request()} d={m.settings_reading_receipts_request_desc()}>
			<Toggle on={s.requestReceipts} onChange={(v) => set('requestReceipts', v)} />
		</Row>
		<Row t={m.settings_reading_receipts_respond()}>
			<Select
				value={s.sendReceipts}
				options={labelled(RECEIPT_LABELS)}
				onChange={(v) => set('sendReceipts', v)}
			/>
		</Row>
	</div>
{/if}
