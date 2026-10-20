<script lang="ts">
	import Check from '@lucide/svelte/icons/check';

	interface Props {
		label: string;
		lines: string[];
		progress: number;
	}

	let { label, lines, progress }: Props = $props();

	const i = $derived(Math.max(0, Math.min(progress, lines.length)));
	const pct = $derived(lines.length ? Math.min(100, Math.round((i / lines.length) * 100)) : 0);
</script>

<div class="cer-progress">
	<div class="cp-bar"><i style:width={pct + '%'}></i></div>
	<div class="cp-label">{label}</div>
	<ul class="cp-lines">
		{#each lines as line, j (j)}
			<li class:done={j < i} class:active={j === i}>
				<span class="cpl-ic">
					{#if j < i}
						<Check size={13} />
					{:else if j === i}
						<span class="spin"></span>
					{:else}
						<span class="pend"></span>
					{/if}
				</span>
				{line}
			</li>
		{/each}
	</ul>
</div>
