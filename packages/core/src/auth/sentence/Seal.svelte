<script lang="ts">
	import { getLocale } from '$paraglide/runtime.js';

	let { label, reserve = true }: { label: string; reserve?: boolean } = $props();

	const at = new Date();
	const stamp = new Intl.DateTimeFormat(getLocale(), {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(at);
</script>

<div class="sp-seal" class:free={!reserve} role="status">
	<span class="sp-seal-rule" aria-hidden="true"></span>
	<p class="sp-seal-mark">{label}<span aria-hidden="true"> · </span><time datetime={at.toISOString()}>{stamp}</time></p>
</div>
