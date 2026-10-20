<script lang="ts">
	import { THEME_META, theme, type ThemePref } from '$core/stores/theme.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
	import SecHead from '../SecHead.svelte';
	import SettingsGate from '../SettingsGate.svelte';
	import Row from '../Row.svelte';
	import Seg from '../Seg.svelte';
	import Card from '../Card.svelte';
	import { m } from '$paraglide/messages.js';
</script>

<SecHead desc={m.settings_appearance_desc()} />

<Card title={m.settings_appearance_theme_title()}>
	<SettingsGate controls={['select']}>
		<Row t={m.settings_appearance_colour_mode()} d={m.settings_appearance_colour_mode_desc()}>
			<Seg
				value={theme.pref}
				options={[
					{ v: 'light', l: THEME_META.light.label(), icon: 'sun' },
					{ v: 'dark', l: THEME_META.dark.label(), icon: 'moon' },
					{ v: 'auto', l: THEME_META.auto.label(), icon: 'monitor' }
				]}
				onChange={(v) => settingsDraft.setTheme(v as ThemePref)}
			/>
		</Row>
	</SettingsGate>
</Card>
