<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { faCheck } from '@fortawesome/pro-regular-svg-icons';

	let { lines, at, failed = false }: { lines: string[]; at: number; failed?: boolean } = $props();
</script>

<ol class="sp-work" aria-live="polite">
	{#each lines as line, i (i)}
		<li class:done={i < at} class:on={i === at && !failed}>
			<span class="ic">
				{#if i < at}
					<Icon icon={faCheck} size={16} />
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
