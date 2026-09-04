<script lang="ts">
	import { Switch } from '$lib/components/ui/switch';
	import { cal } from '../state.svelte';

	const VALUES = [
		{
			title: 'Working hours',
			body: 'Shaded on the week grid. Outside these hours a slot is never offered automatically.',
			value: 'Mon–Fri · 09:00–18:00 · CEST'
		},
		{
			title: 'Travel and turnaround buffer',
			body: 'Added before and after anything with a physical location, and before in-person to remote transitions.',
			value: '15 min'
		}
	];

	const TOGGLES = [
		{
			title: 'Treat Holds as busy',
			body: 'A private hold blocks a slot. Its title is never read to decide — there isn’t one.',
			on: true
		},
		{
			title: 'Explain every suggestion',
			body: 'Each offered time carries the reason it was chosen and the conflict it avoided. Turning this off does not make suggestions faster; it makes them unaccountable.',
			on: true
		},
		{
			title: 'Move commitments automatically',
			body: 'Off, and off by default. Thelemail proposes a plan and shows what would move; you approve it.',
			on: false
		}
	];
</script>

{#each VALUES as rule (rule.title)}
	<div class="srow">
		<div class="sr-m">
			<div class="sr-t">{rule.title}</div>
			<div class="sr-s">{rule.body}</div>
		</div>
		<span class="sr-v">{rule.value}</span>
	</div>
{/each}
{#each TOGGLES as rule (rule.title)}
	<div class="srow">
		<div class="sr-m">
			<div class="sr-t">{rule.title}</div>
			<div class="sr-s">{rule.body}</div>
		</div>
		<Switch checked={rule.on} onCheckedChange={() => cal.unbuilt()} aria-label={rule.title} />
	</div>
{/each}
