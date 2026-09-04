<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import type { Component } from 'svelte';
	import type { BoundaryLine } from './types';

	interface Props {
		heading: string;
		headingIcon?: Component;
		lines: BoundaryLine[];
		noIcon?: 'x' | 'eye-off';
	}

	let { heading, headingIcon, lines, noIcon = 'eye-off' }: Props = $props();

	const HeadIcon = $derived(headingIcon);
</script>

<div class="bnd">
	<div class="bnd-h">
		{#if HeadIcon}<HeadIcon size={13} />{/if}
		{heading}
	</div>
	{#each lines as line (line.text)}
		<div class="bnd-l {line.tone}">
			{#if line.tone === 'yes'}
				<Check size={14} />
			{:else if line.tone === 'warn'}
				<TriangleAlert size={14} />
			{:else if noIcon === 'x'}
				<X size={14} />
			{:else}
				<EyeOff size={14} />
			{/if}
			<div>
				{line.text}
				{#if line.mono}<div class="m">{line.mono}</div>{/if}
			</div>
		</div>
	{/each}
</div>
