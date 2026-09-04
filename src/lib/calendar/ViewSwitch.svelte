<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { cal } from './state.svelte';
	import type { View } from './types';

	const VIEWS: { value: View; label: string }[] = [
		{ value: 'week', label: 'Week' },
		{ value: 'month', label: 'Month' },
		{ value: 'agenda', label: 'Agenda' }
	];

	const current = $derived(VIEWS.find((v) => v.value === cal.view));
</script>

<ToggleGroup.Root
	type="single"
	variant="outline"
	size="sm"
	value={cal.view}
	onValueChange={(value) => value && cal.goTo(value as View)}
	class="viewseg"
>
	{#each VIEWS as view (view.value)}
		<ToggleGroup.Item
			value={view.value}
			aria-label="{view.label} view"
			class="font-semibold data-[state=on]:text-pine-700"
		>
			{view.label}
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>

<DropdownMenu.Root>
	<DropdownMenu.Trigger class="viewdrop">
		{current?.label ?? 'View'}<ChevronDown size={15} />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content class="cal-surface cal-menu w-40" align="end">
		{#each VIEWS as view (view.value)}
			<DropdownMenu.Item onSelect={() => cal.goTo(view.value)}>{view.label}</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
