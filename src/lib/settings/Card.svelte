<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title?: string;
		danger?: boolean;
		head?: Snippet;
		badge?: Snippet;
		children: Snippet;
	}

	let { title, danger = false, head, badge, children }: Props = $props();
	const hasHeader = $derived(!!head || !!title);
</script>

<div class="scard" class:danger>
	{#if hasHeader}
		<div class="scard-h">
			{#if head}{@render head()}{/if}
			{#if title}<h3>{title}</h3>{/if}
			{#if badge}<span class="badge-slot">{@render badge()}</span>{/if}
		</div>
	{/if}
	{@render children()}
</div>

<style>
	.badge-slot {
		margin-left: auto;
	}
</style>
