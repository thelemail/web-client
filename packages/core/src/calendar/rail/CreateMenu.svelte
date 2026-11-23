<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faCalendarClock,
		faCalendarDays,
		faCalendarPlus,
		faChevronDown,
		faGlobe,
		faListCheck,
		faLock,
		faPlus
	} from '@fortawesome/pro-regular-svg-icons';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';

	let open = $state(false);
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger class="create">
		<span class="cr-main"><Icon icon={faPlus} size={18} />{m.cal_create()}</span>
		<span class="cr-caret"><Icon icon={faChevronDown} size={15} /></span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="cal-surface cal-menu w-60" align="start">
		<DropdownMenu.Item onSelect={() => cal.openEditor({ mode: 'create', kind: 'event' })}>
			<Icon icon={faCalendarDays} size={16} />{m.cal_create_event()}<span class="rt">E</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => cal.openEditor({ mode: 'create', kind: 'task' })}>
			<Icon icon={faListCheck} size={16} />{m.cal_create_task()}<span class="rt">T</span>
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => cal.openEditor({ mode: 'create', kind: 'hold' })}>
			<Icon icon={faLock} size={16} />{m.cal_create_hold()}<span class="rt">H</span>
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'create' })}>
			<Icon icon={faCalendarPlus} size={16} />{m.cal_create_calendar()}
		</DropdownMenu.Item>
		{#if import.meta.env.DEV}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => (cal.dialog = 'offer')}>
				<Icon icon={faCalendarClock} size={16} />{m.cal_create_proposal()}<span class="rt">P</span>
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => cal.goTo('booking')}>
				<Icon icon={faGlobe} size={16} />{m.cal_create_booking()}
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
