<script lang="ts">
	import SecHead from '../SecHead.svelte';
	import SettingsGate from '../SettingsGate.svelte';
	import Row from '../Row.svelte';
	import Seg from '../Seg.svelte';
	import Select from '../Select.svelte';
	import Card from '../Card.svelte';
	import type { SettingsState } from '../data';
	import { MARK_READ_LABELS, isMarkReadOption } from '$core/stores/accountSettings.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();

	const labelled = (labels: Record<string, () => string>) =>
		Object.entries(labels).map(([v, l]) => ({ v, l: l() }));
</script>

<SecHead desc={m.settings_reading_desc()} />

<Card title={m.settings_reading_open_title()}>
	<SettingsGate controls={['select', 'select']}>
		<Row t={m.settings_reading_mark_read()}>
			<Select
				value={s.markRead}
				options={labelled(MARK_READ_LABELS)}
				onChange={(v) => {
					if (isMarkReadOption(v)) set('markRead', v);
				}}
			/>
		</Row>
		<Row t={m.settings_sending_reply_button()} d={m.settings_sending_reply_button_desc()}>
			<Seg
				value={s.replyDefault}
				options={[
					{ v: 'reply', l: m.settings_sending_reply() },
					{ v: 'all', l: m.settings_sending_reply_all() }
				]}
				onChange={(v) => set('replyDefault', v)}
			/>
		</Row>
	</SettingsGate>
</Card>
