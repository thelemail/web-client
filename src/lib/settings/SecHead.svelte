<script lang="ts">
	interface Props {
		desc?: string;
	}

	let { desc }: Props = $props();
</script>

{#if desc}
	<div class="sec-h"><p>{desc}</p></div>
{/if}
