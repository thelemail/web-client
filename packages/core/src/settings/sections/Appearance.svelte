<script lang="ts">
	import { THEME_META, theme, type ThemePref } from '$core/stores/theme.svelte';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Seg from '../Seg.svelte';
	import CardHead from '../CardHead.svelte';
	import type { SettingsState } from '../data';
	import { m } from '$paraglide/messages.js';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<SecHead desc={m.settings_appearance_desc()} />

<div class="scard">
	<CardHead title={m.settings_appearance_theme_title()} />
	<Row t={m.settings_appearance_colour_mode()} d={m.settings_appearance_colour_mode_desc()}>
		<Seg
			value={theme.pref}
			options={[
				{ v: 'light', l: THEME_META.light.label(), icon: 'sun' },
				{ v: 'dark', l: THEME_META.dark.label(), icon: 'moon' },
				{ v: 'auto', l: THEME_META.auto.label(), icon: 'monitor' }
			]}
			onChange={(v) => accountSettings.setTheme(v as ThemePref)}
		/>
	</Row>
</div>
