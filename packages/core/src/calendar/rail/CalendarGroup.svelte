<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Plus from '@lucide/svelte/icons/plus';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { Label } from '$core/components/ui/label';
	import { cal } from '../state.svelte';
	import type { CalendarGroup } from '../types';
	import CalendarMenu from './CalendarMenu.svelte';

	interface Props {
		title: string;
		group: CalendarGroup;
		addable?: boolean;
		emptyText?: string;
	}

	let { title, group, addable = false, emptyText }: Props = $props();

	const calendars = $derived(cal.calendarsIn(group));
</script>

<div class="cal-group">
	<div class="gh">
		<span>{title}</span>
		{#if addable}
			<button
				type="button"
				class="addbtn"
				aria-label="Add a calendar"
				onclick={() => cal.openCalendarDialog({ mode: 'create' })}
			>
				<Plus size={13} />
			</button>
		{/if}
	</div>
	{#if !calendars.length && emptyText}
		<div class="cal-item cal-empty">{emptyText}</div>
	{/if}
	{#each calendars as entry (entry.id)}
		<div
			class="cal-item"
			class:on={entry.on}
			style:--cc={entry.color}
			title={entry.readOnly ? `${entry.name} — read only` : entry.name}
		>
			<Checkbox
				id="cal-{entry.id}"
				checked={entry.on}
				onCheckedChange={() => cal.toggleCalendar(entry.id)}
				class="size-[17px] rounded-[5px] border-(--cc) data-[state=checked]:border-(--cc) data-[state=checked]:bg-(--cc) data-[state=checked]:text-(--paper-0)"
			/>
			<Label for="cal-{entry.id}" class="cal-nm {group === 'role' ? 'role' : ''}">{entry.name}</Label>
			{#if entry.badge === 'key'}
				<span class="cal-badge" title="A member needs a new key"><KeyRound size={11} /></span>
			{:else if entry.badge}
				<span class="cal-badge">{entry.badge}</span>
			{/if}
			{#if entry.readOnly}
				<span class="cal-ro"><Eye size={13} /></span>
			{:else}
				<CalendarMenu calendarId={entry.id} name={entry.name} />
			{/if}
		</div>
	{/each}
</div>
