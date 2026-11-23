<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import {
		faEllipsis,
		faEyeSlash,
		faPenLine,
		faTrashCan,
		faUsers
	} from '@fortawesome/pro-regular-svg-icons';
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
		<Icon icon={faEllipsis} size={15} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="cal-surface cal-menu w-56" align="end">
		{#if view?.canManage}
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'edit', calendarId })}>
				<Icon icon={faPenLine} size={16} />{m.cal_menu_rename()}
			</DropdownMenu.Item>
		{/if}
		{#if view?.kind === 'shared' && view.canManage}
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'share', calendarId })}>
				<Icon icon={faUsers} size={16} />{m.cal_menu_members()}
			</DropdownMenu.Item>
		{/if}
		<DropdownMenu.Item onSelect={() => cal.toggleCalendar(calendarId)}>
			<Icon icon={faEyeSlash} size={16} />{m.cal_menu_hide()}
		</DropdownMenu.Item>
		{#if view?.canManage}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => cal.openCalendarDialog({ mode: 'delete', calendarId })}>
				<Icon icon={faTrashCan} size={16} />{m.cal_menu_delete()}
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
