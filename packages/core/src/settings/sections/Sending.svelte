<script lang="ts">
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import SecHead from '../SecHead.svelte';
	import SettingsGate from '../SettingsGate.svelte';
	import Row from '../Row.svelte';
	import Seg from '../Seg.svelte';
	import Toggle from '../Toggle.svelte';
	import CardHead from '../CardHead.svelte';
	import type { SettingsState } from '../data';
	import { m } from '$paraglide/messages.js';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<SecHead desc={m.settings_sending_desc()} />

<SettingsGate rows={4}>
<div class="scard">
	<CardHead title={m.settings_sending_compose_title()} />
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
</div>

<div class="scard">
	<CardHead icon={ShieldAlert} title={m.settings_sending_before_title()} />
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
</div>
</SettingsGate>
