<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		title: string;
		children: Snippet;
	}

	let { id, title, children }: Props = $props();
</script>

<section class="sec-group" aria-labelledby={id}>
	<h2 class="sec-group-h" {id}>{title}</h2>
	{@render children()}
</section>
