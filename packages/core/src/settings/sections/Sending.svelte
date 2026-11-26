<script lang="ts">
	import { faShieldExclamation } from '@fortawesome/pro-regular-svg-icons';
	import SecHead from '../SecHead.svelte';
	import SettingsGate from '../SettingsGate.svelte';
	import Row from '../Row.svelte';
	import { Switch } from '$core/components/ui/switch';
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

<Card icon={faShieldExclamation} title={m.settings_sending_before_title()}>
	<SettingsGate controls={['toggle', 'toggle', 'toggle']}>
		<Row
			t={m.settings_sending_confirm_external()}
			d={m.settings_sending_confirm_external_desc()}
		>
			{#snippet children(row)}
				<Switch
					bind:checked={() => s.confirmExternal, (v) => set('confirmExternal', v)}
					aria-labelledby={row.labelId}
					aria-describedby={row.descId}
				/>
			{/snippet}
		</Row>
		<Row t={m.settings_sending_warn_subject()}>
			{#snippet children(row)}
				<Switch
					bind:checked={() => s.confirmSubject, (v) => set('confirmSubject', v)}
					aria-labelledby={row.labelId}
					aria-describedby={row.descId}
				/>
			{/snippet}
		</Row>
		<Row
			t={m.settings_sending_warn_unencrypted()}
			d={m.settings_sending_warn_unencrypted_desc()}
		>
			{#snippet children(row)}
				<Switch
					bind:checked={() => s.confirmUnencrypted, (v) => set('confirmUnencrypted', v)}
					aria-labelledby={row.labelId}
					aria-describedby={row.descId}
				/>
			{/snippet}
		</Row>
	</SettingsGate>
</Card>
