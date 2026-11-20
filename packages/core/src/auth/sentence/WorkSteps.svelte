<script lang="ts">
	import Check from '@lucide/svelte/icons/check';

	let { lines, at, failed = false }: { lines: string[]; at: number; failed?: boolean } = $props();
</script>

<ol class="sp-work" aria-live="polite">
	{#each lines as line, i (i)}
		<li class:done={i < at} class:on={i === at && !failed}>
			<span class="ic">
				{#if i < at}
					<Check size={16} strokeWidth={2.2} />
				{:else if i === at && !failed}
					<span class="spinner"></span>
				{:else}
					<span class="pend"></span>
				{/if}
			</span>
			{line}
		</li>
	{/each}
</ol>
