<script lang="ts">
	import Route from '@lucide/svelte/icons/route';
	import Inbox from '@lucide/svelte/icons/inbox';
	import MailX from '@lucide/svelte/icons/mail-x';
	import { fmt } from './dates';
	import type { LifecycleContext } from './types';

	let { ctx, compact = false }: { ctx: LifecycleContext; compact?: boolean } = $props();

	const day = $derived(ctx.ladder.day);
	const nodes = $derived([
		{
			day: 0,
			dt: fmt.med(ctx.dates.end),
			nm: 'Subscription ends',
			sub: 'Sending pauses. Mailbox becomes read-only.',
			danger: false
		},
		{
			day: 30,
			dt: fmt.med(ctx.dates.suspend),
			nm: 'Mailbox goes inactive',
			sub: 'Stops accepting mail. Senders get a bounce.',
			danger: false
		},
		{
			day: 90,
			dt: fmt.med(ctx.dates.remove),
			nm: 'Data deleted',
			sub: 'Only if you never restore or export.',
			danger: true
		}
	]);

	function seg(v: number): number {
		if (v <= 0) return 0;
		if (v <= 30) return (v / 30) * 50;
		return 50 + Math.min(1, (v - 30) / 60) * 50;
	}

	const pct = $derived(Math.max(0, Math.min(100, seg(day))));
	const hereIdx = $derived(day < 0 ? -1 : day >= 90 ? 2 : day >= 30 ? 1 : 0);
</script>

<div class="lc-tl" class:compact>
	<div class="lc-tl-cap"><Route size={14} />Your timeline · nothing happens without warning</div>
	<div class="lc-track">
		<div class="fill" style="width:{pct}%"></div>
		{#if day >= 0}
			<div class="today" style="left:{pct}%"></div>
		{/if}
	</div>
	<div class="lc-nodes">
		{#each nodes as n, i (i)}
			<div class="lc-node" class:past={day >= n.day} class:here={i === hereIdx} class:danger={n.danger}>
				<span class="dot"></span>
				<span class="dt">{n.dt}</span>
				<span class="nm">{n.nm}</span>
				{#if !compact}<span class="sub">{n.sub}</span>{/if}
			</div>
		{/each}
	</div>
	<div class="lc-phases">
		<div class="lc-phase ok">
			<Inbox size={15} /><span><b>Read-only · 30 days</b>Still receiving mail. Read, search, export.</span>
		</div>
		<div class="lc-phase warn">
			<MailX size={15} /><span><b>Inactive, then deletion</b>New mail bounces. Data kept until the end.</span>
		</div>
	</div>
</div>
