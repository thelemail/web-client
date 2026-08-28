<script lang="ts">
	interface Props {
		title: string;
		desc?: string;
	}

	let { title, desc }: Props = $props();
</script>

<div class="sec-h">
	<h2>{title}<span class="ln"></span></h2>
	{#if desc}<p>{desc}</p>{/if}
</div>
