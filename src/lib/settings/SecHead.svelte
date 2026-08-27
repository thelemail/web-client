<script lang="ts">
	interface Props {
		tag: string;
		title: string;
		desc?: string;
	}

	let { tag, title, desc }: Props = $props();
</script>

<div class="sec-h">
	<div class="sec-eyebrow">{tag}<span class="ln"></span></div>
	<h2>{title}</h2>
	{#if desc}<p>{desc}</p>{/if}
</div>
