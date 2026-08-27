<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import Check from '@lucide/svelte/icons/check';

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
	<h3 class="cd-title">{title}</h3>
	<p class="cd-desc">{desc}</p>
	{#if children}{@render children()}{/if}
</div>
