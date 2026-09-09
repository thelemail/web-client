<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import EventPopover from '../EventPopover.svelte';
	import { cal } from '../state.svelte';

	const HEADINGS = $derived(
		cal.weekStartsOn === 1
			? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
			: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
	);

	let openKey = $state<string | null>(null);
</script>

<div class="mv">
	<div class="mv-dow">
		{#each HEADINGS as heading (heading)}
			<div class:we={heading === 'Sat' || heading === 'Sun'}>{heading}</div>
		{/each}
	</div>
	<div class="mv-grid">
		{#each cal.monthCells as cell (cell.date)}
			<div
				class="mv-cell"
				class:out={cell.outside}
				class:we={cell.weekend}
				class:is-today={cell.today}
				role="presentation"
				ondblclick={() =>
					cal.openEditor({ mode: 'create', kind: 'event', prefill: { date: cell.date } })}
			>
				<button
					type="button"
					class="mv-dh"
					aria-label="Open {cell.date} in the week view"
					onclick={() => cal.goToDate(cell.date, 'week')}
				>
					<span class="mv-dnum">{cell.n}</span>
				</button>
				{#each cell.entries as entry (entry.key)}
					<Popover.Root
						open={openKey === entry.key}
						onOpenChange={(next) => (openKey = next ? entry.key : null)}
					>
						<Popover.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									class="mv-mev"
									class:allday={entry.allDay}
									style:--c={entry.color}
								>
									<span class="mev-dot"></span>
									{#if entry.time}<span class="mev-tm">{entry.time}</span>{/if}
									<span class="mev-t">{entry.title}</span>
								</button>
							{/snippet}
						</Popover.Trigger>
						<EventPopover selection={cal.describe(entry.occ)} onClose={() => (openKey = null)} />
					</Popover.Root>
				{/each}
				{#if cell.more}
					<button type="button" class="mv-more" onclick={() => cal.goToDate(cell.date, 'agenda')}>
						{cell.more}
					</button>
				{/if}
			</div>
		{/each}
	</div>
</div>
