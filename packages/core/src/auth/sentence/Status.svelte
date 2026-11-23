<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	let {
		id,
		tone = 'hint',
		children
	}: {
		id?: string;
		tone?: 'hint' | 'ok' | 'bad' | 'busy';
		children?: Snippet;
	} = $props();
</script>

<div class="sp-status" {id} data-tone={tone} role="status">
	{#if children}
		{#if tone === 'bad'}
			<span class="sp-status-line" role="alert"><CircleAlert size={14} strokeWidth={1.75} /><span>{@render children()}</span></span>
		{:else}
			<span class="sp-status-line">
				{#if tone === 'ok'}<CircleCheck size={14} strokeWidth={1.75} />{:else if tone === 'busy'}<span class="spinner"></span>{/if}<span>{@render children()}</span>
			</span>
		{/if}
	{/if}
</div>
