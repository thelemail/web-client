<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faCheck } from '@fortawesome/pro-regular-svg-icons';

	let { lines, at, failed = false }: { lines: string[]; at: number; failed?: boolean } = $props();

	const pct = $derived(Math.round((Math.min(at, lines.length) / lines.length) * 100));
</script>

<div class="af-bar" aria-hidden="true"><i style:width="{pct}%"></i></div>
<ol class="af-work" aria-live="polite">
	{#each lines as line, i (i)}
		<li class:done={i < at} class:on={i === at && !failed} class:failed={i === at && failed}>
			<span class="ic">
				{#if i < at}
					<Icon icon={faCheck} size={14} />
				{:else if i === at && !failed}
					<span class="spinner"></span>
				{/if}
			</span>
			{line}
		</li>
	{/each}
</ol>
