<script lang="ts">
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Globe from '@lucide/svelte/icons/globe';
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import Lock from '@lucide/svelte/icons/lock';
	import Plus from '@lucide/svelte/icons/plus';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { cal } from '../state.svelte';

	let open = $state(false);
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger class="create">
		<span class="cr-main"><Plus size={18} />Create</span>
		<span class="cr-caret"><ChevronDown size={15} /></span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="cal-surface cal-menu w-60" align="start">
		<DropdownMenu.Item onSelect={() => cal.unbuilt()}>
			<CalendarDays size={16} />Event<span class="rt">E</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => (cal.tasksOpen = true)}>
			<ListTodo size={16} />Task<span class="rt">T</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => cal.unbuilt()}>
			<Lock size={16} />Hold (private busy)<span class="rt">H</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => (cal.dialog = 'offer')}>
			<CalendarClock size={16} />Proposal — offer times<span class="rt">P</span>
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => cal.goTo('booking')}>
			<Globe size={16} />Booking page
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
