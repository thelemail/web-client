<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import EventPopover from '../EventPopover.svelte';
	import { cal } from '../state.svelte';

	let openKey = $state<string | null>(null);
</script>

<div class="tg-allday">
	<div class="tg-allday-lbl">All day</div>
	<div class="tg-allday-track">
		<div class="tg-allday-cells"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
		{#each cal.allDayRows as entry (entry.key)}
			<Popover.Root
				open={openKey === entry.key}
				onOpenChange={(next) => (openKey = next ? entry.key : null)}
			>
				<Popover.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							class="adev"
							class:solid={entry.solid}
							style:--c={entry.color}
							style:--row={entry.row}
							style:--colstart={entry.day + 1}
							style:--colspan={entry.span}
						>
							<span class="ad-dot"></span>
							<span class="ad-t">{entry.title}</span>
						</button>
					{/snippet}
				</Popover.Trigger>
				<EventPopover selection={cal.describe(entry.occ)} onClose={() => (openKey = null)} />
			</Popover.Root>
		{/each}
	</div>
</div>
