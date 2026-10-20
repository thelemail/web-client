<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Card from '../Card.svelte';
	import Row from '../Row.svelte';
	import Toggle from '../Toggle.svelte';
	import SettingsGate from '../SettingsGate.svelte';
	import type { SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<Card icon={EyeOff} title={m.settings_security_privacy()}>
	<Row t={m.settings_security_remote_images()} d={m.settings_security_remote_images_desc()}>
		<span class="t-mono-xs" style="color: var(--success-700)">{m.settings_security_always_proxied()}</span>
	</Row>
	<SettingsGate controls={['toggle', 'toggle']}>
		<Row t={m.settings_security_strip_tracking()} d={m.settings_security_strip_tracking_desc()}>
			<Toggle
				on={s.stripTrack}
				label={m.settings_security_strip_tracking()}
				onChange={(v) => set('stripTrack', v)}
			/>
		</Row>
		<Row t={m.settings_security_spam_headers()} d={m.settings_security_spam_headers_desc()}>
			<Toggle
				on={s.shareSpamHeaders}
				label={m.settings_security_spam_headers()}
				onChange={(v) => set('shareSpamHeaders', v)}
			/>
		</Row>
	</SettingsGate>
</Card>
