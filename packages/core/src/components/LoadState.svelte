<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { Button } from '$core/components/ui/button';
	import { delayed } from '$core/async/delayed.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		kind: 'loading' | 'error';
		label: string;
		rows?: number;
		retrying?: boolean;
		onRetry?: () => void;
		skeleton?: Snippet;
		class?: string;
	}

	let { kind, label, rows = 2, retrying = false, onRetry, skeleton, class: klass = '' }: Props = $props();

	const shown = delayed(() => kind === 'loading', { minVisible: 0 });
</script>

{#if kind === 'error'}
	<div class="load-err {klass}" role="alert">
		<CircleAlert size={16} />
		<p>{label}</p>
		{#if onRetry}
			<Button variant="secondary" size="sm" disabled={retrying} onclick={onRetry}>
				<RefreshCw />{m.common_retry()}
			</Button>
		{/if}
	</div>
{:else}
	<div class="load-skel {klass}" aria-busy="true">
		<span class="sr-only">{label}</span>
		{#if shown.visible}
			{#if skeleton}
				{@render skeleton()}
			{:else}
				{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
					<div class="load-row" aria-hidden="true">
						<span class="load-bar t"></span>
						<span class="load-bar d"></span>
					</div>
				{/each}
			{/if}
		{/if}
	</div>
{/if}

<style>
	.load-err {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--danger-100) 45%, transparent);
	}
	.load-err > :global(svg) {
		color: var(--danger-500);
		flex: 0 0 auto;
	}
	.load-err p {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 13.5px;
		font-weight: 500;
		color: var(--danger-700);
		line-height: 1.45;
	}
	.load-row {
		padding: 14px 16px;
	}
	.load-skel :global(.load-bar) {
		display: block;
		border-radius: var(--radius-xs);
		background: color-mix(in oklab, var(--fg-strong) 8%, transparent);
		animation: load-pulse 1.4s ease-in-out infinite;
	}
	.load-bar.t {
		width: min(44%, 200px);
		height: 11px;
	}
	.load-bar.d {
		width: min(72%, 320px);
		height: 8px;
		margin-top: 9px;
		opacity: 0.65;
	}
	@keyframes load-pulse {
		50% {
			opacity: 0.5;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.load-skel :global(.load-bar) {
			animation: none;
		}
	}
</style>
