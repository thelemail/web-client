<script lang="ts">
	import Clock from '@lucide/svelte/icons/clock';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Seg from '../Seg.svelte';
	import CardHead from '../CardHead.svelte';
	import { accountSettings } from '$lib/stores/accountSettings.svelte';
	import type { SettingsState } from '../data';

	interface Props {
		s: SettingsState;
		set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
	}

	let { s, set }: Props = $props();
</script>

<SecHead
	tag="06 — Localization & region"
	title="Localization & region"
	desc="How dates and times are written across your mailbox."
/>

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
