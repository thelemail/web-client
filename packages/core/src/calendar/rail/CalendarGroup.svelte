<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import { faEye, faKey, faPlus } from '@fortawesome/pro-regular-svg-icons';
	import { Checkbox } from '$core/components/ui/checkbox';
	import { Label } from '$core/components/ui/label';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';
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
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={m.cal_group_add_aria()}
				onclick={() => cal.openCalendarDialog({ mode: 'create' })}
			>
				<Icon icon={faPlus} size={13} />
			</Button>
		{/if}
	</div>
	{#if !calendars.length && emptyText && calendarStore.loaded}
		<div class="cal-item cal-empty">{emptyText}</div>
	{/if}
	{#each calendars as entry (entry.id)}
		<div
			class="cal-item"
			class:on={entry.on}
			style:--cc={entry.color}
			title={entry.readOnly ? m.cal_group_read_only_title({ name: entry.name }) : entry.name}
		>
			<Checkbox
				id="cal-{entry.id}"
				checked={entry.on}
				onCheckedChange={() => cal.toggleCalendar(entry.id)}
				class="size-[17px] border-(--cc) data-[state=checked]:border-(--cc) data-[state=checked]:bg-(--cc) data-[state=checked]:text-(--bg)"
			/>
			<Label for="cal-{entry.id}" class="cal-nm {group === 'role' ? 'role' : ''}">{entry.name}</Label>
			{#if entry.badge === 'key'}
				<span class="cal-badge" title={m.cal_group_key_badge_title()}><Icon icon={faKey} size={11} /></span>
			{:else if entry.badge}
				<span class="cal-badge">{entry.badge}</span>
			{/if}
			{#if entry.readOnly}
				<span class="cal-ro"><Icon icon={faEye} size={13} /></span>
			{:else}
				<CalendarMenu calendarId={entry.id} name={entry.name} />
			{/if}
		</div>
	{/each}
</div>
