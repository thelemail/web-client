<script lang="ts">
	import ICAL from 'ical.js';

	interface Props {
		value: string | undefined;
		startDate: string;
		onChange: (rrule: string | undefined) => void;
	}

	let { value, startDate, onChange }: Props = $props();

	type Freq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
	const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
	const DAY_LABEL: Record<string, string> = { MO: 'M', TU: 'T', WE: 'W', TH: 'T', FR: 'F', SA: 'S', SU: 'S' };

	let freq = $state<Freq>('NONE');
	let interval = $state(1);
	let byday = $state<string[]>([]);
	let ends = $state<'never' | 'on' | 'after'>('never');
	let until = $state('');
	let count = $state(10);
	let custom = $state(false);
	let seeded = false;

	function dayOf(date: string): string {
		const d = new Date(`${date}T00:00:00Z`);
		return DAYS[(d.getUTCDay() + 6) % 7];
	}

	$effect(() => {
		if (seeded) return;
		seeded = true;
		if (!value) return;
		try {
			const r = ICAL.Recur.fromString(value);
			freq = r.freq as Freq;
			interval = r.interval || 1;
			byday = ((r.parts.BYDAY as string[] | undefined) ?? []).map((d) => d.replace(/^[-+]?\d+/, ''));
			if (r.count) {
				ends = 'after';
				count = r.count;
			} else if (r.until) {
				ends = 'on';
				until = r.until.toString().slice(0, 10);
			}
			custom = interval > 1 || ends !== 'never' || (freq === 'WEEKLY' && byday.length > 1);
		} catch {
			freq = 'NONE';
		}
	});

	function emit() {
		if (freq === 'NONE') {
			onChange(undefined);
			return;
		}
		const parts: string[] = [`FREQ=${freq}`];
		if (interval > 1) parts.push(`INTERVAL=${interval}`);
		if (freq === 'WEEKLY') {
			const days = byday.length ? byday : [dayOf(startDate)];
			parts.push(`BYDAY=${days.join(',')}`);
		}
		if (ends === 'after' && count > 0) parts.push(`COUNT=${count}`);
		if (ends === 'on' && until) parts.push(`UNTIL=${until.replace(/-/g, '')}T235959`);
		onChange(parts.join(';'));
	}

	function pick(next: Freq) {
		freq = next;
		if (next === 'WEEKLY' && !byday.length) byday = [dayOf(startDate)];
		emit();
	}

	function toggleDay(d: string) {
		byday = byday.includes(d) ? byday.filter((x) => x !== d) : [...byday, d];
		if (!byday.length) byday = [dayOf(startDate)];
		emit();
	}
</script>

<div class="rec">
	<div class="seg">
		{#each [['NONE', 'Once'], ['DAILY', 'Daily'], ['WEEKLY', 'Weekly'], ['MONTHLY', 'Monthly'], ['YEARLY', 'Yearly']] as [key, label] (key)}
			<button type="button" class:on={freq === key} onclick={() => pick(key as Freq)}>{label}</button>
		{/each}
	</div>
	{#if freq !== 'NONE'}
		<button type="button" class="rec-more" onclick={() => (custom = !custom)}>
			{custom ? 'Fewer options' : 'More options'}
		</button>
		{#if freq === 'WEEKLY'}
			<div class="rec-days">
				{#each DAYS as d (d)}
					<button type="button" class:on={byday.includes(d)} aria-label={d} onclick={() => toggleDay(d)}>
						{DAY_LABEL[d]}
					</button>
				{/each}
			</div>
		{/if}
		{#if custom}
			<div class="rec-row">
				<label>
					Every
					<input type="number" min="1" max="99" bind:value={interval} onchange={emit} />
					{freq === 'DAILY' ? 'days' : freq === 'WEEKLY' ? 'weeks' : freq === 'MONTHLY' ? 'months' : 'years'}
				</label>
			</div>
			<div class="rec-row">
				<label>
					Ends
					<select bind:value={ends} onchange={emit}>
						<option value="never">never</option>
						<option value="on">on a date</option>
						<option value="after">after</option>
					</select>
				</label>
				{#if ends === 'on'}
					<input type="date" bind:value={until} onchange={emit} />
				{:else if ends === 'after'}
					<label><input type="number" min="1" max="999" bind:value={count} onchange={emit} /> times</label>
				{/if}
			</div>
		{/if}
	{/if}
</div>
