<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		top?: boolean;
		badges?: Snippet;
		actions?: Snippet;
		children?: Snippet;
	}

	let { label, top = false, badges, actions, children }: Props = $props();
</script>

<div class="rec-row" class:top>
	<div class="rec-main">
		<div class="rec-title">
			<span class="rec-label">{label}</span>
			{#if badges}{@render badges()}{/if}
		</div>
		{#if children}{@render children()}{/if}
	</div>
	{#if actions}{@render actions()}{/if}
</div>
