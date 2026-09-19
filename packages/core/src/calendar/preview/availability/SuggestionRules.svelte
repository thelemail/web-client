<script lang="ts">
	import { Switch } from '$core/components/ui/switch';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';

	const VALUES = [
		{
			key: 'hours',
			title: () => m.cal_rules_working_hours(),
			body: () => m.cal_rules_working_hours_body(),
			value: () => 'Mon–Fri · 09:00–18:00 · CEST'
		},
		{
			key: 'buffer',
			title: () => m.cal_rules_buffer(),
			body: () => m.cal_rules_buffer_body(),
			value: () => m.cal_rules_buffer_value()
		}
	];

	const TOGGLES = [
		{
			key: 'holds',
			title: () => m.cal_rules_holds_busy(),
			body: () => m.cal_rules_holds_busy_body(),
			on: true
		},
		{
			key: 'explain',
			title: () => m.cal_rules_explain(),
			body: () => m.cal_rules_explain_body(),
			on: true
		},
		{
			key: 'move',
			title: () => m.cal_rules_move_auto(),
			body: () => m.cal_rules_move_auto_body(),
			on: false
		}
	];
</script>

{#each VALUES as rule (rule.key)}
	<div class="srow">
		<div class="sr-m">
			<div class="sr-t">{rule.title()}</div>
			<div class="sr-s">{rule.body()}</div>
		</div>
		<span class="sr-v">{rule.value()}</span>
	</div>
{/each}
{#each TOGGLES as rule (rule.key)}
	<div class="srow">
		<div class="sr-m">
			<div class="sr-t">{rule.title()}</div>
			<div class="sr-s">{rule.body()}</div>
		</div>
		<Switch checked={rule.on} onCheckedChange={() => cal.unbuilt()} aria-label={rule.title()} />
	</div>
{/each}
