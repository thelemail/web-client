<script lang="ts">
	import type { Snippet } from 'svelte';

	type Kind = 'ok' | 'warn' | 'info' | 'pine' | 'neutral';

	interface Props {
		kind?: Kind;
		dot?: boolean;
		children: Snippet;
	}

	let { kind = 'neutral', dot = false, children }: Props = $props();
</script>

<span class={'badge b-' + kind}>
	{#if dot}<span class="dot"></span>{/if}{@render children()}
</span>
