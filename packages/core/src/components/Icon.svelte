<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import type { SVGAttributes } from 'svelte/elements';

	interface Props extends Omit<SVGAttributes<SVGSVGElement>, 'viewBox'> {
		icon: IconDefinition;
		size?: number | string;
	}

	const OPTICAL = 0.875;

	let { icon, size = 24, class: className, ...rest }: Props = $props();

	const viewBox = $derived.by(() => {
		const [w, h] = icon.icon;
		const side = Math.max(w, h) / OPTICAL;
		return `${(w - side) / 2} ${(h - side) / 2} ${side} ${side}`;
	});
	const paths = $derived.by(() => {
		const d = icon.icon[4];
		return Array.isArray(d) ? d : [d];
	});
	const labelled = $derived(rest['aria-label'] != null || rest['aria-labelledby'] != null);
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	{viewBox}
	fill="currentColor"
	aria-hidden={labelled ? undefined : 'true'}
	role={labelled ? 'img' : undefined}
	class={['icon', `icon-${icon.iconName}`, className]}
	{...rest}
>
	{#each paths as d, i (i)}<path {d} />{/each}
</svg>
