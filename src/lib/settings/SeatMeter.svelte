<script lang="ts">
	interface Props {
		used: number;
		total: number;
	}

	let { used, total }: Props = $props();
</script>

<span class="seat-meter" title={used + ' of ' + total + ' seats used'}>
	{#each { length: total }, i (i)}
		<span class="seat-dot" class:used={i < used}></span>
	{/each}
</span>
