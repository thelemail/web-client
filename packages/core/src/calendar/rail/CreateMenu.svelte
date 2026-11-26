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
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';

	let open = $state(false);
</script>

<div class="btn-split create">
	<Button variant="primary" class="cr-main" onclick={() => cal.openEditor({ mode: 'create', kind: 'event' })}>
		<Icon icon={faPlus} size={18} />{m.cal_create()}
	</Button>
	<DropdownMenu.Root bind:open>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="primary" size="icon" aria-label={m.cal_create_more()}>
					<Icon icon={faChevronDown} size={15} />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="w-60" align="start">
			<DropdownMenu.Item onSelect={() => cal.openEditor({ mode: 'create', kind: 'event' })}>
				<Icon icon={faCalendarDays} size={16} />{m.cal_create_event()}<DropdownMenu.Shortcut>E</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => cal.openEditor({ mode: 'create', kind: 'task' })}>
				<Icon icon={faListCheck} size={16} />{m.cal_create_task()}<DropdownMenu.Shortcut>T</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => cal.openEditor({ mode: 'create', kind: 'hold' })}>
				<Icon icon={faLock} size={16} />{m.cal_create_hold()}<DropdownMenu.Shortcut>H</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'create' })}>
				<Icon icon={faCalendarPlus} size={16} />{m.cal_create_calendar()}
			</DropdownMenu.Item>
			{#if import.meta.env.DEV}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={() => (cal.dialog = 'offer')}>
					<Icon icon={faCalendarClock} size={16} />{m.cal_create_proposal()}<DropdownMenu.Shortcut>P</DropdownMenu.Shortcut>
				</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={() => cal.goTo('booking')}>
					<Icon icon={faGlobe} size={16} />{m.cal_create_booking()}
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
