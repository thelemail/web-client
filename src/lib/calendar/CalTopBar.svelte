<script lang="ts">
	import Menu from '@lucide/svelte/icons/menu';
	import Dot from '@lucide/svelte/icons/dot';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import Bell from '@lucide/svelte/icons/bell';
	import ViewSwitch from './ViewSwitch.svelte';
	import UserMenu from './UserMenu.svelte';
	import { cal } from './state.svelte';

	let inputRef: HTMLInputElement | undefined = $state();

	function handleKey(e: KeyboardEvent) {
		const tag = (document.activeElement as HTMLElement | null)?.tagName;
		if (e.key === '/' && document.activeElement !== inputRef && !/^(INPUT|TEXTAREA)$/.test(tag ?? '')) {
			e.preventDefault();
			inputRef?.focus();
		}
	}
</script>

<svelte:document onkeydown={handleKey} />

<header class="topbar">
	<button class="icon-btn menu-btn" title="Menu" onclick={() => (cal.navOpen = !cal.navOpen)}>
		<Menu size={18} />
	</button>
	<div class="datenav">
		<button class="today-btn" onclick={cal.goToday}><Dot size={15} />Today</button>
		<div class="nav-arrows">
			<button title="Previous" onclick={() => cal.step(-1)}><ChevronLeft size={19} /></button>
			<button title="Next" onclick={() => cal.step(1)}><ChevronRight size={19} /></button>
		</div>
	</div>
	<h1 class="cal-title">
		{cal.title.main}{#if cal.title.sub}<span class="yr">{cal.title.sub}</span>{/if}
	</h1>

	<div class="topspace"></div>

	<div class="cal-search">
		<Search size={16} />
		<input
			bind:this={inputRef}
			value={cal.query}
			oninput={(e) => cal.setQuery((e.currentTarget as HTMLInputElement).value)}
			placeholder="Search events"
		/>
	</div>

	<ViewSwitch />

	<div class="tb-actions">
		<button class="icon-btn" title="Notifications"><Bell size={18} /><span class="nd"></span></button>
		<UserMenu />
	</div>
</header>
