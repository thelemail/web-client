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
		faListCheck,
		faMagnifyingGlass
	} from '@fortawesome/pro-regular-svg-icons';
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
						icon: faInbox,
						dot: true,
						on: false,
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
			run: () => (cal.tasksOpen = !cal.tasksOpen)
		},
		{
			key: 'sync',
			label: m.cal_topbar_sync(),
			icon: faArrowsRotate,
			dot: calendarStore.pendingCount > 0 || calendarStore.blockedCount > 0,
			on: calendarStore.syncing,
			run: () => (cal.dialog = 'sync')
		},
		{
			key: 'settings',
			label: m.cal_topbar_settings(),
			icon: faGear,
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
		<Icon icon={faBars} size={18} />
	</button>

	{#if cal.isDated}
		<Button variant="secondary" size="sm" onclick={() => cal.goToday()}>
			<Icon icon={faCalendarClock} size={15} />{m.cal_topbar_today()}
		</Button>
		<div class="nav-arrows">
			<button type="button" aria-label={m.cal_topbar_prev_aria()} onclick={() => cal.prev()}>
				<Icon icon={faChevronLeft} size={19} />
			</button>
			<button type="button" aria-label={m.cal_topbar_next_aria()} onclick={() => cal.next()}>
				<Icon icon={faChevronRight} size={19} />
			</button>
		</div>
	{/if}

	<div class="cal-title">{cal.title}<span class="yr">{cal.titleYear}</span></div>
	<div class="topspace"></div>

	<div class="cal-search">
		<Icon icon={faMagnifyingGlass} size={16} />
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
						<Icon icon={action.icon} size={18} />
						{#if action.dot}<i class="nd"></i>{/if}
					</Tooltip.Trigger>
					<Tooltip.Content>{action.label}</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		{/each}
	</div>
</div>
