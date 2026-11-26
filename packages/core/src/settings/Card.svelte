<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Heading from './Heading.svelte';
	import { getHeadingLevel, setHeadingLevel } from './a11y';

	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'class'> {
		title?: string;
		right?: Snippet;
		variant?: 'menus' | 'danger';
		as?: 'div' | 'section';
		class?: string;
		headClass?: string;
		titleClass?: string;
		children: Snippet;
	}

	let {
		title,
		right,
		variant,
		as = 'div',
		class: extra,
		headClass,
		titleClass,
		children,
		...rest
	}: Props = $props();

	const level = getHeadingLevel();
	setHeadingLevel(untrack(() => title) ? level + 1 : level);
</script>

{#if title}
	<svelte:element this={as} {...rest} class={['scard-group', variant, extra]}>
		<div class={['scard-h', headClass]}>
			<Heading {level} class={['scard-title', titleClass]}>{title}</Heading>
			{#if right}{@render right()}{/if}
		</div>
		<div class={['scard', variant]}>{@render children()}</div>
	</svelte:element>
{:else}
	<svelte:element this={as} {...rest} class={['scard', variant, extra]}>{@render children()}</svelte:element>
{/if}
