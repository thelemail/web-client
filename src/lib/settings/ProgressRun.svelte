<script lang="ts">
	import Check from '@lucide/svelte/icons/check';

	interface Props {
		label: string;
		lines: string[];
		onDone?: () => void;
		progress?: number;
	}

	let { label, lines, onDone, progress }: Props = $props();

	let auto = $state(0);
	const controlled = $derived(progress !== undefined);

	$effect(() => {
		if (controlled) return;
		const current = auto;
		if (current >= lines.length) {
			if (!onDone) return;
			const t = setTimeout(onDone, 500);
			return () => clearTimeout(t);
		}
		const t = setTimeout(() => {
			auto = current + 1;
		}, 700);
		return () => clearTimeout(t);
	});

	const i = $derived(controlled ? Math.min(progress ?? 0, lines.length) : auto);
	const pct = $derived(Math.min(100, Math.round((i / lines.length) * 100)));
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
