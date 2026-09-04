<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Eye from '@lucide/svelte/icons/eye';
	import Plus from '@lucide/svelte/icons/plus';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { cal } from '../state.svelte';
	import type { CalendarGroup } from '../types';

	interface Props {
		title: string;
		group: CalendarGroup;
		addable?: boolean;
	}

	let { title, group, addable = false }: Props = $props();

	const calendars = $derived(cal.calendarsIn(group));
</script>

<div class="cal-group">
	<div class="gh">
		<span>{title}</span>
		{#if addable}
			<button type="button" class="addbtn" aria-label="Add a calendar" onclick={() => cal.unbuilt()}>
				<Plus size={13} />
			</button>
		{/if}
	</div>
	{#each calendars as entry (entry.id)}
		<div
			class="cal-item"
			class:on={entry.on}
			style:--cc={entry.color}
			title={entry.readOnly ? `${entry.name} — subscribed, read-only` : entry.name}
		>
			<Checkbox
				id="cal-{entry.id}"
				checked={entry.on}
				onCheckedChange={() => cal.toggleCalendar(entry.id)}
				class="size-[17px] rounded-[5px] border-(--cc) data-[state=checked]:border-(--cc) data-[state=checked]:bg-(--cc) data-[state=checked]:text-(--paper-0)"
			/>
			<Label for="cal-{entry.id}" class="cal-nm {group === 'role' ? 'role' : ''}">{entry.name}</Label>
			{#if entry.badge}
				<span class="cal-badge">{entry.badge}</span>
			{:else if entry.readOnly}
				<span class="cal-ro"><Eye size={13} /></span>
			{:else}
				<button
					type="button"
					class="cal-x"
					aria-label="{entry.name} options"
					onclick={() => cal.unbuilt()}
				>
					<Ellipsis size={15} />
				</button>
			{/if}
		</div>
	{/each}
</div>
