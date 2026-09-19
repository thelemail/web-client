<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';
	import ListTodo from '@lucide/svelte/icons/list-todo';
	import Menu from '@lucide/svelte/icons/menu';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import { Button } from '$core/components/ui/button';
	import * as Tooltip from '$core/components/ui/tooltip';
	import { m } from '$paraglide/messages.js';
	import ViewSwitch from './ViewSwitch.svelte';
	import { cal } from './state.svelte';
	import { calendarStore } from './store.svelte';

	const slot = $derived(page.params.slot ?? '0');

	const actions = $derived([
		...(import.meta.env.DEV
			? [
					{
						key: 'mail',
						label: m.cal_topbar_mail_commitments(),
						icon: Inbox,
						dot: true,
						on: false,
						run: () => (cal.dialog = 'mail')
					}
				]
			: []),
		{
			key: 'tasks',
			label: m.cal_topbar_tasks(),
			icon: ListTodo,
			dot: false,
			on: cal.tasksOpen,
			run: () => (cal.tasksOpen = !cal.tasksOpen)
		},
		{
			key: 'sync',
			label: m.cal_topbar_sync(),
			icon: RefreshCw,
			dot: calendarStore.pendingCount > 0 || calendarStore.blockedCount > 0,
			on: calendarStore.syncing,
			run: () => (cal.dialog = 'sync')
		},
		{
			key: 'settings',
			label: m.cal_topbar_settings(),
			icon: Settings,
			dot: false,
			on: false,
			run: () => void goto(`/u/${slot}/settings/region`)
		}
	]);
</script>

<div class="topbar">
	<button
		type="button"
		class="icon-btn menu-btn"
		aria-label={m.cal_topbar_menu_aria()}
		onclick={() => (cal.navOpen = true)}
	>
		<Menu size={18} />
	</button>

	{#if cal.isDated}
		<Button variant="secondary" size="sm" onclick={() => cal.goToday()}>
			<CalendarClock size={15} />{m.cal_topbar_today()}
		</Button>
		<div class="nav-arrows">
			<button type="button" aria-label={m.cal_topbar_prev_aria()} onclick={() => cal.prev()}>
				<ChevronLeft size={19} />
			</button>
			<button type="button" aria-label={m.cal_topbar_next_aria()} onclick={() => cal.next()}>
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
			placeholder={m.cal_topbar_search_placeholder()}
			aria-label={m.cal_topbar_search_aria()}
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
