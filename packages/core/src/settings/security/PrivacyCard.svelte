<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Card from '../Card.svelte';
	import Row from '../Row.svelte';
	import { Switch } from '$core/components/ui/switch';
	import SettingsGate from '../SettingsGate.svelte';
	import type { SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<Card title={m.settings_security_privacy()}>
	<Row t={m.settings_security_remote_images()} d={m.settings_security_remote_images_desc()}>
		<span class="t-mono-xs" style="color: var(--success-700)">{m.settings_security_always_proxied()}</span>
	</Row>
	<SettingsGate controls={['toggle', 'toggle']}>
		<Row t={m.settings_security_strip_tracking()} d={m.settings_security_strip_tracking_desc()}>
			{#snippet children(row)}
				<Switch
					bind:checked={() => s.stripTrack, (v) => set('stripTrack', v)}
					aria-label={m.settings_security_strip_tracking()}
					aria-describedby={row.descId}
				/>
			{/snippet}
		</Row>
		<Row t={m.settings_security_spam_headers()} d={m.settings_security_spam_headers_desc()}>
			{#snippet children(row)}
				<Switch
					bind:checked={() => s.shareSpamHeaders, (v) => set('shareSpamHeaders', v)}
					aria-label={m.settings_security_spam_headers()}
					aria-describedby={row.descId}
				/>
			{/snippet}
		</Row>
	</SettingsGate>
</Card>
