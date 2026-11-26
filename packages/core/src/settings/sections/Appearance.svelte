<script lang="ts">
	import { THEME_META, theme, type ThemePref } from '$core/stores/theme.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
	import SecHead from '../SecHead.svelte';
	import SettingsGate from '../SettingsGate.svelte';
	import Row from '../Row.svelte';
	import { Segmented } from '$core/components/ui/segmented';
	import Card from '../Card.svelte';
	import { m } from '$paraglide/messages.js';
	import { faDisplay, faMoon, faSun } from '@fortawesome/pro-regular-svg-icons';
</script>

<SecHead desc={m.settings_appearance_desc()} />

<Card title={m.settings_appearance_theme_title()}>
	<SettingsGate controls={['select']}>
		<Row t={m.settings_appearance_colour_mode()} d={m.settings_appearance_colour_mode_desc()}>
			{#snippet children(row)}
				<Segmented
					bind:value={() => theme.pref, (v) => v && settingsDraft.setTheme(v)}
					options={[
						{ value: 'light' as ThemePref, label: THEME_META.light.label(), icon: faSun },
						{ value: 'dark' as ThemePref, label: THEME_META.dark.label(), icon: faMoon },
						{ value: 'auto' as ThemePref, label: THEME_META.auto.label(), icon: faDisplay }
					]}
					aria-labelledby={row.labelId}
					aria-describedby={row.descId}
				/>
			{/snippet}
		</Row>
	</SettingsGate>
</Card>
