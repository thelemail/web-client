<script lang="ts">
	import type { Snippet } from 'svelte';
	import Heading from '../Heading.svelte';
	import { getHeadingLevel, setHeadingLevel } from '../a11y';

	interface Props {
		id: string;
		title: string;
		children: Snippet;
	}

	let { id, title, children }: Props = $props();

	const level = getHeadingLevel();
	setHeadingLevel(level + 1);
</script>

<section class="sec-group" aria-labelledby={id}>
	<Heading {level} class="sec-group-h" {id}>{title}</Heading>
	{@render children()}
</section>
