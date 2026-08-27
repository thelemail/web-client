<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import Clock from '@lucide/svelte/icons/clock';
	import CheckSquare from '@lucide/svelte/icons/check-square';
	import Moon from '@lucide/svelte/icons/moon';
	import Check from '@lucide/svelte/icons/check';
	import MoreVertical from '@lucide/svelte/icons/more-vertical';
	import logoWordmark from '$lib/assets/logo-wordmark-inverse.svg';
	import MiniMonth from './MiniMonth.svelte';
	import { CALENDARS } from './data';
	import { cal, TODAY, opts } from './state.svelte';

	const mine = CALENDARS.filter((c) => c.group === 'mine');
	const other = CALENDARS.filter((c) => c.group === 'other');

	let crOpen = $state(false);
	let crRef: HTMLDivElement | undefined = $state();

	function handleDoc(e: MouseEvent) {
		if (crRef && !crRef.contains(e.target as Node)) crOpen = false;
	}
</script>

<svelte:document onmousedown={handleDoc} />

<aside class="rail">
	<div class="brand"><img src={logoWordmark} alt="Thelemail" /></div>

	<div class="create" bind:this={crRef}>
		<button class="cr-main" onclick={() => cal.openCreate('quick')}>
			<Plus size={18} />Create
		</button>
		<button class="cr-caret" onclick={() => (crOpen = !crOpen)} title="More options">
			<ChevronDown size={15} />
		</button>
		{#if crOpen}
			<div class="cr-menu">
				<button onclick={() => { crOpen = false; cal.openCreate('event'); }}>
					<CalendarPlus size={16} />Event
				</button>
				<button onclick={() => { crOpen = false; cal.openCreate('quick'); }}>
					<Clock size={16} />Quick event
				</button>
				<button onclick={() => { crOpen = false; cal.openCreate('task'); }}>
					<CheckSquare size={16} />Task
				</button>
				<button onclick={() => { crOpen = false; cal.openCreate('focus'); }}>
					<Moon size={16} />Focus time
				</button>
			</div>
		{/if}
	</div>

	<div class="rail-scroll">
		<MiniMonth
			cursor={cal.cursor}
			today={TODAY}
			selected={cal.cursor}
			weekStartsMon={opts.weekStartsMon}
			eventDays={cal.eventDays}
			onPick={cal.pickDate}
		/>

		{#each [{ label: 'My calendars', items: mine }, { label: 'Other calendars', items: other }] as group (group.label)}
			<div class="cal-group">
				<div class="gh">
					<span>{group.label}</span>
					<button class="addbtn" title="Add calendar"><Plus size={14} /></button>
				</div>
				{#each group.items as c (c.id)}
					<button
						class="cal-item"
						class:on={cal.vis[c.id]}
						style:--cc={c.color}
						onclick={() => cal.toggleCal(c.id)}
					>
						<span class="cal-cb"><Check size={12} /></span>
						<span class="cal-nm">{c.name}</span>
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<span class="cal-x" title="Calendar options" onclick={(e) => e.stopPropagation()}>
							<MoreVertical size={15} />
						</span>
					</button>
				{/each}
			</div>
		{/each}
	</div>
</aside>
