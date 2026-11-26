<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowsRotate,
		faBars,
		faCalendarClock,
		faChevronLeft,
		faChevronRight,
		faGear,
		faInbox,
		faListCheck
	} from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import { SearchField } from '$core/components/ui/search-field';
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
						icon: faInbox,
						dot: true,
						on: false,
						toggle: false,
						run: () => (cal.dialog = 'mail')
					}
				]
			: []),
		{
			key: 'tasks',
			label: m.cal_topbar_tasks(),
			icon: faListCheck,
			dot: false,
			on: cal.tasksOpen,
			toggle: true,
			run: () => (cal.tasksOpen = !cal.tasksOpen)
		},
		{
			key: 'sync',
			label: m.cal_topbar_sync(),
			icon: faArrowsRotate,
			dot: calendarStore.pendingCount > 0 || calendarStore.blockedCount > 0,
			on: calendarStore.syncing,
			toggle: false,
			run: () => (cal.dialog = 'sync')
		},
		{
			key: 'settings',
			label: m.cal_topbar_settings(),
			icon: faGear,
			dot: false,
			on: false,
			toggle: false,
			run: () => void goto(`/u/${slot}/settings/region`)
		}
	]);
</script>

<div class="topbar">
	<Button
		variant="ghost"
		size="icon-sm"
		class="menu-btn"
		aria-label={m.cal_topbar_menu_aria()}
		onclick={() => (cal.navOpen = true)}
	>
		<Icon icon={faBars} size={18} />
	</Button>

	{#if cal.isDated}
		<Button variant="neutral" size="sm" onclick={() => cal.goToday()}>
			<Icon icon={faCalendarClock} size={15} />{m.cal_topbar_today()}
		</Button>
		<div class="nav-arrows">
			<Button variant="ghost" size="icon-sm" aria-label={m.cal_topbar_prev_aria()} onclick={() => cal.prev()}>
				<Icon icon={faChevronLeft} size={19} />
			</Button>
			<Button variant="ghost" size="icon-sm" aria-label={m.cal_topbar_next_aria()} onclick={() => cal.next()}>
				<Icon icon={faChevronRight} size={19} />
			</Button>
		</div>
	{/if}

	<div class="cal-title">{cal.title}<span class="yr">{cal.titleYear}</span></div>
	<div class="topspace"></div>

	<SearchField
		class="cal-search"
		size="sm"
		placeholder={m.cal_topbar_search_placeholder()}
		aria-label={m.cal_topbar_search_aria()}
		bind:value={cal.query}
	/>

	<ViewSwitch />

	<div class="tb-actions">
		{#each actions as action (action.key)}
			<Button
				variant="ghost"
				size="icon-sm"
				tooltip={action.label}
				tooltipSide="bottom"
				aria-pressed={action.toggle ? action.on : action.on || undefined}
				onclick={action.run}
			>
				<Icon icon={action.icon} size={18} />
				{#if action.dot}<i class="nd"></i>{/if}
			</Button>
		{/each}
	</div>
</div>
