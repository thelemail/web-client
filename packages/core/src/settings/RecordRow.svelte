<script lang="ts">
	import CopyBtn from './CopyBtn.svelte';
	import type { NewRecord } from './types';
	import { m } from '$paraglide/messages.js';

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
			{m.settings_record_host()} <code>{r.host}</code>{#if r.ttl} · {m.settings_record_ttl()} <code>{r.ttl}</code>{/if}
		</span>
		<CopyBtn text={r.value} small />
	</div>
	<div class="rec-val"><code>{r.value}</code></div>
</div>
