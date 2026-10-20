<script lang="ts">
	import { untrack, type Component, type Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Heading from './Heading.svelte';
	import { getHeadingLevel, setHeadingLevel } from './a11y';

	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'class'> {
		title?: string;
		icon?: Component<{ size?: number }>;
		right?: Snippet;
		variant?: 'flat' | 'menus' | 'danger';
		as?: 'div' | 'section';
		class?: string;
		headClass?: string;
		titleClass?: string;
		children: Snippet;
	}

	let {
		title,
		icon: IconComponent,
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

<svelte:element this={as} {...rest} class={['scard', variant, extra]}>
	{#if title}
		<div class={['scard-h', headClass]}>
			{#if IconComponent}<IconComponent size={16} />{/if}
			<Heading {level} class={['scard-title', titleClass]}>{title}</Heading>
			{#if right}{@render right()}{/if}
		</div>
	{/if}
	{@render children()}
</svelte:element>
