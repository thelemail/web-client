<script lang="ts">
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';
	import { cal } from '../state.svelte';

	const cap = $derived(cal.capacity);
	const used = $derived(Math.min(cap.total, cap.committed + cap.boxed));
	const eventsPct = $derived(Math.min(100, (cap.committed / cap.total) * 100));
	const boxedPct = $derived(Math.min(100 - eventsPct, (cap.boxed / cap.total) * 100));
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

<div class="tkcap" style:--events-pct="{eventsPct}%" style:--boxed-pct="{boxedPct}%">
	<div class="cap-h"><Rich text={m.cal_capacity_committed({ used, total: cap.total })} tags={{ b: bold }} /></div>
	<div class="cap-bar"><i class="b"></i><i class="t"></i></div>
	<div class="cap-k">
		<span><i class="events"></i>{m.cal_capacity_events()}</span>
		<span><i class="boxed"></i>{m.cal_capacity_timeboxed()}</span>
		<span><i class="free"></i>{m.cal_capacity_unclaimed()}</span>
	</div>
</div>
