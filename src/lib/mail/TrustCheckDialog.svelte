<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import X from '@lucide/svelte/icons/x';
	import { portal } from '$lib/actions/portal';
	import type { TrustCheck } from './trust';

	interface Props {
		check: TrustCheck;
		onClose: () => void;
	}

	let { check, onClose }: Props = $props();

	let panel: HTMLDivElement | undefined = $state();

	$effect(() => {
		panel?.focus();
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="tcd-scrim" use:portal onmousedown={(e) => e.target === e.currentTarget && onClose()}>
	<div
		class="tcd"
		bind:this={panel}
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		aria-label={check.label}
		data-state={check.state}
	>
		<div class="tcd-h">
			<span class="tcd-glyph">
				{#if check.state === 'pass'}
					<Check size={15} />
				{:else if check.state === 'fail'}
					<X size={15} />
				{:else}
					<Minus size={15} />
				{/if}
			</span>
			<h2>{check.label}</h2>
		</div>
		<p class="tcd-explain">{check.explain}</p>
		{#if check.rows.length > 0}
			<dl class="tcd-rows">
				{#each check.rows as row, i (row.label + i)}
					<div>
						<dt>{row.label}</dt>
						<dd>{row.value}</dd>
					</div>
				{/each}
			</dl>
		{/if}
		<button class="tcd-close" onclick={onClose}>Close</button>
	</div>
</div>

<style>
	.tcd-scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		background: color-mix(in oklab, var(--ink-900) 38%, transparent);
	}

	.tcd {
		width: 100%;
		max-width: 420px;
		max-height: calc(100vh - 40px);
		overflow-y: auto;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 20px 22px 18px;
	}

	.tcd:focus {
		outline: none;
	}

	.tcd-h {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin-bottom: 10px;
	}

	.tcd-glyph {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		flex: 0 0 auto;
		margin-top: 1px;
	}
	.tcd[data-state='pass'] .tcd-glyph {
		background: var(--success-100);
		color: var(--success-700);
	}
	.tcd[data-state='absent'] .tcd-glyph {
		color: var(--fg-faint);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.tcd[data-state='fail'] .tcd-glyph {
		background: var(--danger-100);
		color: var(--danger-700);
	}

	.tcd h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		line-height: 1.3;
		letter-spacing: var(--track-snug);
		color: var(--fg-strong);
	}

	.tcd-explain {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--fg);
	}

	.tcd-rows {
		margin: 14px 0 0;
		padding: 12px 0 0;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.tcd-rows div {
		display: grid;
		grid-template-columns: 116px 1fr;
		gap: 10px;
		align-items: baseline;
	}
	.tcd-rows dt {
		font-size: 11px;
		color: var(--fg-faint);
	}
	.tcd-rows dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 10.5px;
		line-height: 1.5;
		color: var(--fg);
		word-break: break-word;
	}

	.tcd-close {
		margin-top: 18px;
		width: 100%;
		padding: 8px 12px;
		font-size: 13px;
		font-weight: 560;
		color: var(--fg-strong);
		background: var(--surface-muted);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.tcd-close:hover {
		border-color: var(--border-strong);
	}
</style>
