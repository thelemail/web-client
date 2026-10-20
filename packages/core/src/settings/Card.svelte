<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

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
</script>

<svelte:element this={as} {...rest} class={['scard', variant, extra]}>
	{#if title}
		<div class={['scard-h', headClass]}>
			{#if IconComponent}<IconComponent size={16} />{/if}
			<h3 class={titleClass}>{title}</h3>
			{#if right}{@render right()}{/if}
		</div>
	{/if}
	{@render children()}
</svelte:element>
