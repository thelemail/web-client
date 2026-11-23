<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from '$core/components/Icon.svelte';
	import { untrack, type Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Heading from './Heading.svelte';
	import { getHeadingLevel, setHeadingLevel } from './a11y';

	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'class'> {
		title?: string;
		icon?: IconDefinition;
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
		icon,
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
			{#if icon}<Icon {icon} size={16} />{/if}
			<Heading {level} class={['scard-title', titleClass]}>{title}</Heading>
			{#if right}{@render right()}{/if}
		</div>
	{/if}
	{@render children()}
</svelte:element>
