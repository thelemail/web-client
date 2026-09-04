<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';

	interface Props {
		calendarId: string;
		name: string;
	}

	let { calendarId, name }: Props = $props();

	const view = $derived(calendarStore.calendar(calendarId));
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger class="cal-x" aria-label="{name} options">
		<Ellipsis size={15} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="cal-surface cal-menu w-56" align="end">
		{#if view?.canManage}
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'edit', calendarId })}>
				<PenLine size={16} />Rename or recolour
			</DropdownMenu.Item>
		{/if}
		{#if view?.kind === 'shared' && view.canManage}
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'share', calendarId })}>
				<Users size={16} />Members and key
			</DropdownMenu.Item>
		{/if}
		<DropdownMenu.Item onSelect={() => cal.toggleCalendar(calendarId)}>
			<EyeOff size={16} />Hide from views
		</DropdownMenu.Item>
		{#if view?.canManage}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'delete', calendarId })}>
				<Trash2 size={16} />Delete calendar
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
