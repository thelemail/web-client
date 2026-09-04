<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import * as Popover from '$lib/components/ui/popover';
	import EventPopover from '../EventPopover.svelte';
	import { describeItem } from '../describe';
	import type { WeekBlock } from '../state.svelte';

	interface Props {
		block: WeekBlock;
	}

	let { block }: Props = $props();

	let open = $state(false);
	const selection = $derived(describeItem(block.item));
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="ev k-{block.kind}"
				class:tiny={block.density === 'tiny'}
				class:oneline={block.density === 'oneline'}
				class:done={block.done}
				style:--c={block.color}
				style:--top="{block.top}px"
				style:--h="{block.height}px"
				style:--inset={block.inset}
				style:--depth={block.depth}
			>
				<span class="ev-t">
					{#if block.kind === 'task'}<span class="tk-box"><Check size={9} /></span>{/if}{block.title}
				</span>
				<span class="ev-w">{block.when}</span>
			</button>
		{/snippet}
	</Popover.Trigger>
	<EventPopover {selection} onClose={() => (open = false)} />
</Popover.Root>
