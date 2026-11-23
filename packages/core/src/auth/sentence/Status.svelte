<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import { faCircleCheck, faCircleExclamation } from '@fortawesome/pro-regular-svg-icons';

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
			<span class="sp-status-line" role="alert"><Icon icon={faCircleExclamation} size={14} /><span>{@render children()}</span></span>
		{:else}
			<span class="sp-status-line">
				{#if tone === 'ok'}<Icon icon={faCircleCheck} size={14} />{:else if tone === 'busy'}<span class="spinner"></span>{/if}<span>{@render children()}</span>
			</span>
		{/if}
	{/if}
</div>
