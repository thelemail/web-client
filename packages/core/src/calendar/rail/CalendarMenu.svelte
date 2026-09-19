<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import { m } from '$paraglide/messages.js';
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
	<DropdownMenu.Trigger class="cal-x" aria-label={m.cal_menu_options_aria({ name })}>
		<Ellipsis size={15} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="cal-surface cal-menu w-56" align="end">
		{#if view?.canManage}
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'edit', calendarId })}>
				<PenLine size={16} />{m.cal_menu_rename()}
			</DropdownMenu.Item>
		{/if}
		{#if view?.kind === 'shared' && view.canManage}
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'share', calendarId })}>
				<Users size={16} />{m.cal_menu_members()}
			</DropdownMenu.Item>
		{/if}
		<DropdownMenu.Item onSelect={() => cal.toggleCalendar(calendarId)}>
			<EyeOff size={16} />{m.cal_menu_hide()}
		</DropdownMenu.Item>
		{#if view?.canManage}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'delete', calendarId })}>
				<Trash2 size={16} />{m.cal_menu_delete()}
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
