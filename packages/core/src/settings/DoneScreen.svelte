<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from '$core/components/Icon.svelte';
	import type { Snippet } from 'svelte';
	import { faCheck } from '@fortawesome/pro-regular-svg-icons';
	import Heading from './Heading.svelte';

	interface Props {
		icon?: IconDefinition;
		title: string;
		desc: string;
		children?: Snippet;
	}

	let { icon = faCheck, title, desc, children }: Props = $props();
</script>

<div class="cer-done">
	<span class="cd-badge"><Icon {icon} size={30} /></span>
	<Heading class="cd-title">{title}</Heading>
	<p class="cd-desc">{desc}</p>
	{#if children}{@render children()}{/if}
</div>
