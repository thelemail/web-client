<script lang="ts">
	import { theme, type ThemePref } from '$lib/stores/theme.svelte';
	import { accountSettings } from '$lib/stores/accountSettings.svelte';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Seg from '../Seg.svelte';
	import CardHead from '../CardHead.svelte';
	import type { SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<SecHead
	tag="07 — Appearance"
	title="Appearance"
	desc="The reading room. Calm parchment by day, the inkwell by night — tuned for comfort and access."
/>

<div class="scard">
	<CardHead title="Theme" />
	<Row t="Colour mode" d="Inkwell uses deep pine, not pure black.">
		<Seg
			value={theme.pref}
			options={[
				{ v: 'light', l: 'Parchment', icon: 'sun' },
				{ v: 'dark', l: 'Inkwell', icon: 'moon' },
				{ v: 'auto', l: 'Auto', icon: 'monitor' }
			]}
			onChange={(v) => accountSettings.setTheme(v as ThemePref)}
		/>
	</Row>
</div>
