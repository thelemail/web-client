<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setRowNames } from './a11y';

	interface Props {
		t: string;
		titleSnippet?: Snippet;
		d?: string;
		descSnippet?: Snippet;
		col?: boolean;
		children?: Snippet;
	}

	let { t, titleSnippet, d, descSnippet, col = false, children }: Props = $props();

	const uid = $props.id();
	const hasDesc = $derived(!!descSnippet || !!d);

	setRowNames({
		labelId: `${uid}-t`,
		get descId() {
			return hasDesc ? `${uid}-d` : undefined;
		}
	});
</script>

<div class="setrow" class:col>
	<div class="info">
		<div class="t" id="{uid}-t">{#if titleSnippet}{@render titleSnippet()}{:else}{t}{/if}</div>
		{#if descSnippet}
			<div class="d" id="{uid}-d">{@render descSnippet()}</div>
		{:else if d}
			<div class="d" id="{uid}-d">{d}</div>
		{/if}
	</div>
	{#if children}<div class="ctl">{@render children()}</div>{/if}
</div>
