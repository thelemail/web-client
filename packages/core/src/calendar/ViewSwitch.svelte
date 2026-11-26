<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import { faChevronDown } from '@fortawesome/pro-regular-svg-icons';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import { Segmented } from '$core/components/ui/segmented';
	import { m } from '$paraglide/messages.js';
	import { cal } from './state.svelte';
	import type { View } from './types';

	const VIEWS: { value: View; label: () => string }[] = [
		{ value: 'week', label: () => m.cal_view_week() },
		{ value: 'month', label: () => m.cal_view_month() },
		{ value: 'agenda', label: () => m.cal_view_agenda() }
	];

	const current = $derived(VIEWS.find((v) => v.value === cal.view));
	const options = $derived(VIEWS.map((v) => ({ value: v.value, label: v.label(), ariaLabel: m.cal_view_aria({ view: v.label() }) })));
</script>

<Segmented
	value={cal.view}
	{options}
	onValueChange={(value) => cal.goTo(value)}
	aria-label={m.cal_view_fallback()}
	class="viewseg"
/>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="neutral" size="sm" class="viewdrop">
				{current?.label() ?? m.cal_view_fallback()}<Icon icon={faChevronDown} size={15} />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="cal-surface cal-menu w-40" align="end">
		{#each VIEWS as view (view.value)}
			<DropdownMenu.Item onSelect={() => cal.goTo(view.value)}>{view.label()}</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
