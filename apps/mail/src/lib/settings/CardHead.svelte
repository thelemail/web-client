<script lang="ts">
	import type { Snippet, Component } from 'svelte';

	interface Props {
		icon?: Component;
		title: string;
		right?: Snippet;
	}

	let { icon: IconComponent, title, right }: Props = $props();
</script>

<div class="scard-h">
	{#if IconComponent}<IconComponent size={16} />{/if}
	<h3>{title}</h3>
	{#if right}{@render right()}{/if}
</div>
