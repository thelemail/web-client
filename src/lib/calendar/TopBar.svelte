<script lang="ts">
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import Menu from '@lucide/svelte/icons/menu';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import ViewSwitch from './ViewSwitch.svelte';
	import { cal } from './state.svelte';

	const actions = $derived([
		{
			key: 'mail',
			label: 'Commitments found in mail',
			icon: Inbox,
			dot: !cal.mailDone,
			on: false,
			run: () => (cal.dialog = 'mail')
		},
		{
			key: 'tasks',
			label: 'Tasks',
			icon: ListTodo,
			dot: false,
			on: cal.tasksOpen,
			run: () => (cal.tasksOpen = !cal.tasksOpen)
		},
		{
			key: 'sync',
			label: 'Sync & provenance',
			icon: RefreshCw,
			dot: false,
			on: false,
			run: () => (cal.dialog = 'sync')
		},
		{
			key: 'settings',
			label: 'Settings',
			icon: Settings,
			dot: false,
			on: false,
			run: () => cal.unbuilt()
		}
	]);
</script>

<div class="topbar">
	<button
		type="button"
		class="icon-btn menu-btn"
		aria-label="Open calendar menu"
		onclick={() => (cal.navOpen = true)}
	>
		<Menu size={18} />
	</button>

	{#if cal.isDated}
		<Button variant="secondary" size="sm" onclick={() => cal.goTo('week')}>
			<CalendarClock size={15} />Today
		</Button>
		<div class="nav-arrows">
			<button type="button" aria-label="Previous period" onclick={() => cal.unbuilt()}>
				<ChevronLeft size={19} />
			</button>
			<button type="button" aria-label="Next period" onclick={() => cal.unbuilt()}>
				<ChevronRight size={19} />
			</button>
		</div>
	{/if}

	<div class="cal-title">{cal.title}<span class="yr">{cal.titleYear}</span></div>
	<div class="topspace"></div>

	<div class="cal-search">
		<Search size={16} />
		<input
			type="search"
			placeholder="Search — runs on this device"
			aria-label="Search the calendar"
			bind:value={cal.query}
		/>
	</div>

	<ViewSwitch />

	<div class="tb-actions">
		{#each actions as action (action.key)}
			<Tooltip.Provider delayDuration={300}>
				<Tooltip.Root>
					<Tooltip.Trigger
						class="icon-btn {action.on ? 'on' : ''}"
						aria-label={action.label}
						onclick={action.run}
					>
						<action.icon size={18} />
						{#if action.dot}<i class="nd"></i>{/if}
					</Tooltip.Trigger>
					<Tooltip.Content>{action.label}</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		{/each}
	</div>
</div>
