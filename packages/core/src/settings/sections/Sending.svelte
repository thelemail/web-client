<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import SecHead from '../SecHead.svelte';
	import SettingsGate from '../SettingsGate.svelte';
	import Row from '../Row.svelte';
	import Toggle from '../Toggle.svelte';
	import Card from '../Card.svelte';
	import type { SettingsState } from '../data';
	import { m } from '$paraglide/messages.js';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<SecHead desc={m.settings_sending_desc()} />

<Card icon={ShieldAlert} title={m.settings_sending_before_title()}>
	<SettingsGate controls={['toggle', 'toggle', 'toggle']}>
		<Row
			t={m.settings_sending_confirm_external()}
			d={m.settings_sending_confirm_external_desc()}
		>
			<Toggle on={s.confirmExternal} onChange={(v) => set('confirmExternal', v)} />
		</Row>
		<Row t={m.settings_sending_warn_subject()}>
			<Toggle on={s.confirmSubject} onChange={(v) => set('confirmSubject', v)} />
		</Row>
		<Row
			t={m.settings_sending_warn_unencrypted()}
			d={m.settings_sending_warn_unencrypted_desc()}
		>
			<Toggle on={s.confirmUnencrypted} onChange={(v) => set('confirmUnencrypted', v)} />
		</Row>
	</SettingsGate>
</Card>
