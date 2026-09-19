<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import Languages from '@lucide/svelte/icons/languages';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Seg from '../Seg.svelte';
	import CardHead from '../CardHead.svelte';
	import Select from '../Select.svelte';
	import { m } from '$paraglide/messages.js';
	import { followSystemLocale, i18n, setAppLocale } from '$core/i18n/locale.svelte';
	import { LOCALES, LOCALE_NAMES, isAppLocale, languageTag } from '$core/i18n/locales';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import type { SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();

	const languageOptions = $derived([
		{ v: 'auto', l: m.settings_region_language_auto() },
		...LOCALES.map((locale) => ({ v: locale, l: LOCALE_NAMES[locale], lang: languageTag(locale) }))
	]);

	function chooseLanguage(value: string) {
		if (value === 'auto') void followSystemLocale();
		else if (isAppLocale(value)) setAppLocale(value);
	}
</script>

<SecHead desc="How dates and times are written across your mailbox." />

<div class="scard">
	<CardHead icon={Languages} title={m.settings_region_language_title()} />
	<Row t={m.settings_region_language()} d={m.settings_region_language_desc()}>
		<Select
			value={i18n.explicit ? i18n.locale : 'auto'}
			options={languageOptions}
			onChange={chooseLanguage}
			ariaLabel={m.settings_region_language()}
		/>
	</Row>
</div>

<div class="scard">
	<CardHead icon={Clock} title="Time & date" />
	<Row t="Time zone" d="Detected automatically from your device. Times in your mailbox use this zone.">
		<span class="ctl-aux">{accountSettings.timeZone}</span>
	</Row>
	<Row t="Date format">
		<Seg
			value={s.dateFmt}
			options={[
				{ v: 'dmy', l: '31 Dec 2026' },
				{ v: 'mdy', l: 'Dec 31, 2026' },
				{ v: 'iso', l: '2026-12-31' }
			]}
			onChange={(v) => set('dateFmt', v)}
		/>
	</Row>
	<Row t="Time format">
		<Seg
			value={s.timeFmt}
			options={[
				{ v: '24', l: '24-hour' },
				{ v: '12', l: '12-hour' }
			]}
			onChange={(v) => set('timeFmt', v)}
		/>
	</Row>
</div>
