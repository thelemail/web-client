<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import EventPopover from '../EventPopover.svelte';
	import { describeAllDay } from '../describe';
	import { cal } from '../state.svelte';

	let openId = $state<string | null>(null);
</script>

<div class="tg-allday">
	<div class="tg-allday-lbl">All day</div>
	<div class="tg-allday-track">
		<div class="tg-allday-cells"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
		{#each cal.allDayRows as entry (entry.id)}
			<Popover.Root
				open={openId === entry.id}
				onOpenChange={(next) => (openId = next ? entry.id : null)}
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
				<EventPopover selection={describeAllDay(entry)} onClose={() => (openId = null)} />
			</Popover.Root>
		{/each}
	</div>
</div>
