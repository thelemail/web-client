<script lang="ts">
	import Route from '@lucide/svelte/icons/route';
	import Inbox from '@lucide/svelte/icons/inbox';
	import MailX from '@lucide/svelte/icons/mail-x';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import { fmt } from './dates';
	import type { LifecycleContext } from './types';

	let { ctx, compact = false }: { ctx: LifecycleContext; compact?: boolean } = $props();

	const day = $derived(ctx.ladder.day);
	const nodes = $derived([
		{
			day: 0,
			dt: fmt.med(ctx.dates.end),
			nm: m.lc_timeline_ends_title(),
			sub: m.lc_timeline_ends_sub(),
			danger: false
		},
		{
			day: 30,
			dt: fmt.med(ctx.dates.suspend),
			nm: m.lc_timeline_inactive_title(),
			sub: m.lc_timeline_inactive_sub(),
			danger: false
		},
		{
			day: 90,
			dt: fmt.med(ctx.dates.remove),
			nm: m.lc_timeline_deleted_title(),
			sub: m.lc_timeline_deleted_sub(),
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

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<div class="lc-tl" class:compact>
	<div class="lc-tl-cap"><Route size={14} />{m.lc_timeline_caption()}</div>
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
			<Inbox size={15} /><span><Rich text={m.lc_timeline_phase_read_only()} tags={{ b: bold }} /></span>
		</div>
		<div class="lc-phase warn">
			<MailX size={15} /><span><Rich text={m.lc_timeline_phase_inactive()} tags={{ b: bold }} /></span>
		</div>
	</div>
</div>
