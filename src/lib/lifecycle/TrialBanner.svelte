<script lang="ts">
	import Hourglass from '@lucide/svelte/icons/hourglass';
	import Pin from '@lucide/svelte/icons/pin';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import X from '@lucide/svelte/icons/x';
	import { fmt, daysBetween } from './dates';
	import type { LifecycleContext } from './types';

	let {
		ctx,
		onSee,
		onDismiss
	}: { ctx: LifecycleContext; onSee: () => void; onDismiss: () => void } = $props();

	const locked = $derived(ctx.urgency === 't3');
	const daysLeft = $derived(Math.max(0, daysBetween(ctx.dates.trialEnd, ctx.now)));
</script>

<div class="sysalerts">
	<div class="sysalert sa-trial">
		<span class="sa-ic"><Hourglass size={15} /></span>
		<span class="sa-tx">
			<span class="sa-h">
				{daysLeft}
				{daysLeft === 1 ? 'day' : 'days'} left in your free trial. Ends {fmt.med(ctx.dates.trialEnd)}.
			</span>
			<span class="sa-d">
				After that your account stays read-only for 30 days. You keep receiving mail and can export
				anything. Nothing is deleted.
			</span>
		</span>
		<span class="sa-acts">
			{#if locked}
				<span class="sa-locktag"><Pin size={12} />Pinned</span>
			{/if}
			<button class="sa-act solid" onclick={onSee}>See your options<ArrowRight size={13} /></button>
			{#if !locked}
				<button class="sa-dismiss" title="Dismiss" onclick={onDismiss}><X size={15} /></button>
			{/if}
		</span>
	</div>
</div>
