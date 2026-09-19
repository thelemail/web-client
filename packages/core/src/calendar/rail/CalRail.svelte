<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$paraglide/messages.js';
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
		<span class="wm-sub">{m.cal_rail_subtitle()}</span>
	</a>

	<CreateMenu />

	<div class="rail-scroll">
		<MiniMonth />
		<CalendarGroup title={m.cal_rail_my_calendars()} group="mine" addable />
		<CalendarGroup
			title={m.cal_rail_role_calendars()}
			group="role"
			addable
			emptyText={m.cal_rail_role_empty()}
		/>
	</div>

	<RailNav />
	<RailAccount />
</div>
