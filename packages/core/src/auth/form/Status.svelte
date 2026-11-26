<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import { faCircleCheck, faCircleExclamation } from '@fortawesome/pro-regular-svg-icons';

	let {
		id,
		tone = 'hint',
		reserve = false,
		children
	}: {
		id?: string;
		tone?: 'hint' | 'ok' | 'bad' | 'busy';
		reserve?: boolean;
		children?: Snippet;
	} = $props();
</script>

<p class="af-status" class:reserve {id} data-tone={tone} role={tone === 'bad' ? 'alert' : 'status'}>
	{#if children}
		{#if tone === 'bad'}<Icon icon={faCircleExclamation} size={14} />{:else if tone === 'ok'}<Icon
				icon={faCircleCheck}
				size={14}
			/>{:else if tone === 'busy'}<span class="spinner"></span>{/if}<span>{@render children()}</span>
	{/if}
</p>
