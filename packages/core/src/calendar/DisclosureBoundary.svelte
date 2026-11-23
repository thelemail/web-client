<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from '$core/components/Icon.svelte';
	import {
		faCheck,
		faEyeSlash,
		faTriangleExclamation,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import type { BoundaryLine } from './types';

	interface Props {
		heading: string;
		headingIcon?: IconDefinition;
		lines: BoundaryLine[];
		noIcon?: 'x' | 'eye-off';
	}

	let { heading, headingIcon, lines, noIcon = 'eye-off' }: Props = $props();

	const HeadIcon = $derived(headingIcon);
</script>

<div class="bnd">
	<div class="bnd-h">
		{#if HeadIcon}<Icon icon={HeadIcon} size={13} />{/if}
		{heading}
	</div>
	{#each lines as line (line.text)}
		<div class="bnd-l {line.tone}">
			{#if line.icon}
				<Icon icon={line.icon} size={14} />
			{:else if line.tone === 'yes'}
				<Icon icon={faCheck} size={14} />
			{:else if line.tone === 'warn'}
				<Icon icon={faTriangleExclamation} size={14} />
			{:else if noIcon === 'x'}
				<Icon icon={faXmark} size={14} />
			{:else}
				<Icon icon={faEyeSlash} size={14} />
			{/if}
			<div>
				{line.text}
				{#if line.mono}<div class="m">{line.mono}</div>{/if}
			</div>
		</div>
	{/each}
</div>
