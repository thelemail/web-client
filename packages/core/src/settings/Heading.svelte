<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { getHeadingLevel } from './a11y';

	interface Props extends HTMLAttributes<HTMLHeadingElement> {
		level?: number;
		children: Snippet;
	}

	let { level, children, ...rest }: Props = $props();

	const inherited = getHeadingLevel();
	const tag = $derived(`h${Math.min(level ?? inherited, 6)}`);
</script>

<svelte:element this={tag} {...rest}>{@render children()}</svelte:element>
