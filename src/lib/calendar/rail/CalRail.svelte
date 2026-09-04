<script lang="ts">
	import { page } from '$app/state';
	import CalendarGroup from './CalendarGroup.svelte';
	import CreateMenu from './CreateMenu.svelte';
	import MiniMonth from './MiniMonth.svelte';
	import RailAccount from './RailAccount.svelte';
	import RailNav from './RailNav.svelte';

	const slot = $derived(page.params.slot ?? '0');
</script>

<div class="rail">
	<a class="brand" href="/u/{slot}/mail/inbox">
		<span class="wm">Thelemail</span>
		<span class="wm-sub">Calendar</span>
	</a>

	<CreateMenu />

	<div class="rail-scroll">
		<MiniMonth />
		<CalendarGroup title="My calendars" group="mine" addable />
		<CalendarGroup title="Role calendars" group="role" addable />
		<CalendarGroup title="Subscribed &amp; mirrored" group="other" />
	</div>

	<RailNav />
	<RailAccount />
</div>
