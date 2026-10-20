<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

	interface Props {
		kind: 'loading' | 'error';
		label: string;
		rows?: number;
		retrying?: boolean;
		onRetry?: () => void;
	}

	let { kind, label, rows = 2, retrying = false, onRetry }: Props = $props();
</script>

{#if kind === 'error'}
	<div class="setrow set-loaderr" role="alert">
		<CircleAlert size={16} />
		<p>{label}</p>
		{#if onRetry}
			<Button variant="secondary" size="sm" disabled={retrying} onclick={onRetry}>
				<RefreshCw />{m.common_retry()}
			</Button>
		{/if}
	</div>
{:else}
	<div class="set-skel" aria-busy="true">
		<span class="sr-only">{label}</span>
		{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
			<div class="setrow" aria-hidden="true">
				<div class="info">
					<span class="sk-bar sk-t"></span>
					<span class="sk-bar sk-d"></span>
				</div>
			</div>
		{/each}
	</div>
{/if}
