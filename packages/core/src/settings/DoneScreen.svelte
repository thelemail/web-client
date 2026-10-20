<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import Heading from './Heading.svelte';

	interface Props {
		icon?: Component;
		title: string;
		desc: string;
		children?: Snippet;
	}

	let { icon: IconComponent = Check, title, desc, children }: Props = $props();
</script>

<div class="cer-done">
	<span class="cd-badge"><IconComponent size={30} /></span>
	<Heading class="cd-title">{title}</Heading>
	<p class="cd-desc">{desc}</p>
	{#if children}{@render children()}{/if}
</div>
