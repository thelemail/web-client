<script lang="ts">
	import { cal } from '../state.svelte';

	const cap = $derived(cal.capacity);
	const used = $derived(Math.min(cap.total, cap.committed + cap.boxed));
	const eventsPct = $derived(Math.min(100, (cap.committed / cap.total) * 100));
	const boxedPct = $derived(Math.min(100 - eventsPct, (cap.boxed / cap.total) * 100));
</script>

<div class="tkcap" style:--events-pct="{eventsPct}%" style:--boxed-pct="{boxedPct}%">
	<div class="cap-h">Committed this week <b>{used}h of {cap.total}h</b></div>
	<div class="cap-bar"><i class="b"></i><i class="t"></i></div>
	<div class="cap-k">
		<span><i class="events"></i>Events</span>
		<span><i class="boxed"></i>Timeboxed tasks</span>
		<span><i class="free"></i>Unclaimed</span>
	</div>
</div>
