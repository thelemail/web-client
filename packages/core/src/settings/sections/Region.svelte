<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import Languages from '@lucide/svelte/icons/languages';
	import SecHead from '../SecHead.svelte';
	import SettingsGate from '../SettingsGate.svelte';
	import Row from '../Row.svelte';
	import Seg from '../Seg.svelte';
	import Card from '../Card.svelte';
	import Select from '../Select.svelte';
	import { formatDateLong } from '$core/mail/data';
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

	const SAMPLE = new Date(2026, 11, 31, 12);

	function sample(pattern: 'dmy' | 'mdy' | 'iso'): string {
		return formatDateLong(SAMPLE, pattern);
	}

	function chooseLanguage(value: string) {
		if (value === 'auto') void followSystemLocale();
		else if (isAppLocale(value)) setAppLocale(value);
	}
</script>

<SecHead desc={m.settings_region_desc()} />

<Card icon={Languages} title={m.settings_region_language_title()}>
	<Row t={m.settings_region_language()} d={m.settings_region_language_desc()}>
		<Select
			value={i18n.explicit ? i18n.locale : 'auto'}
			options={languageOptions}
			onChange={chooseLanguage}
			ariaLabel={m.settings_region_language()}
		/>
	</Row>
</Card>

<Card icon={Clock} title={m.settings_region_time_title()}>
	<Row t={m.settings_region_time_zone()} d={m.settings_region_time_zone_desc()}>
		<span class="ctl-aux">{accountSettings.timeZone}</span>
	</Row>
	<SettingsGate controls={['select', 'select']}>
		<Row t={m.settings_region_date_format()}>
			<Seg
				value={s.dateFmt}
				options={[
					{ v: 'dmy', l: sample('dmy') },
					{ v: 'mdy', l: sample('mdy') },
					{ v: 'iso', l: sample('iso') }
				]}
				onChange={(v) => set('dateFmt', v)}
			/>
		</Row>
		<Row t={m.settings_region_time_format()}>
			<Seg
				value={s.timeFmt}
				options={[
					{ v: '24', l: m.settings_region_time_24h() },
					{ v: '12', l: m.settings_region_time_12h() }
				]}
				onChange={(v) => set('timeFmt', v)}
			/>
		</Row>
	</SettingsGate>
</Card>
