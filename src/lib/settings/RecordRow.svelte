<script lang="ts">
	import CopyBtn from './CopyBtn.svelte';
	import type { NewRecord } from './types';

	interface Props {
		r: NewRecord;
	}

	let { r }: Props = $props();
</script>

<div class="rec-row">
	<div class="rec-head">
		<span class="rec-type">{r.label ?? r.type}</span>
		<span class="rec-kind">{r.type}</span>
		<span class="rec-meta">
			Host <code>{r.host}</code>{#if r.ttl} · TTL <code>{r.ttl}</code>{/if}
		</span>
		<CopyBtn text={r.value} small />
	</div>
	<div class="rec-val"><code>{r.value}</code></div>
</div>
