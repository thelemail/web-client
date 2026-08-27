<script lang="ts">
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Lock from '@lucide/svelte/icons/lock';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import X from '@lucide/svelte/icons/x';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { portal } from '$lib/actions/portal';
	import type { MessageTrust, TrustTier } from './trust';

	interface Props {
		trust: MessageTrust;
		variant?: 'chip' | 'icon' | 'static';
		onConfirmKeyChange?: () => void | Promise<void>;
	}

	let { trust, variant = 'icon', onConfirmKeyChange }: Props = $props();

	const MARKS = {
		verified: ShieldCheck,
		encrypted: Lock,
		authenticated: CircleCheck,
		none: CircleDashed,
		attention: KeyRound,
		failed: ShieldAlert
	} satisfies Record<TrustTier, unknown>;

	const Mark = $derived(MARKS[trust.tier]);

	let open = $state(false);
	let tech = $state(false);
	let busy = $state(false);
	let anchor: HTMLButtonElement | undefined = $state();
	let panel: HTMLDivElement | undefined = $state();
	let pos = $state({ left: -9999, top: -9999, ready: false });

	function place() {
		if (!anchor || !panel) return;
		const rect = anchor.getBoundingClientRect();
		const w = panel.offsetWidth;
		const h = panel.offsetHeight;
		const gap = 8;
		let left = rect.left;
		if (left + w > window.innerWidth - 12) left = window.innerWidth - w - 12;
		if (left < 12) left = 12;
		let top = rect.bottom + gap;
		if (top + h > window.innerHeight - 12) top = Math.max(12, rect.top - gap - h);
		pos = { left, top, ready: true };
	}

	$effect(() => {
		if (!open) {
			pos = { left: -9999, top: -9999, ready: false };
			tech = false;
			return;
		}
		void trust;
		void tech;
		place();
	});

	function toggle() {
		open = !open;
	}

	async function confirm() {
		if (!onConfirmKeyChange || busy) return;
		busy = true;
		try {
			await onConfirmKeyChange();
			open = false;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && open) open = false;
	}}
	onresize={() => open && place()}
/>

{#if variant === 'static'}
	<span class="tmark" data-tier={trust.tier} data-variant="icon" title={trust.label}>
		<Mark size={13} />
	</span>
{:else}
	<button
		class="tmark"
		data-tier={trust.tier}
		data-variant={variant}
		bind:this={anchor}
		aria-expanded={open}
		aria-label={trust.label}
		onclick={(e) => {
			e.stopPropagation();
			toggle();
		}}
	>
		<Mark size={variant === 'chip' ? 12 : 13} />
		{#if variant === 'chip'}<span class="tmark-label">{trust.label}</span>{/if}
	</button>
{/if}

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="tpop-scrim" use:portal onclick={() => (open = false)}></div>
	<div
		class="tpop"
		data-tier={trust.tier}
		use:portal
		bind:this={panel}
		role="dialog"
		aria-label={trust.headline}
		style:left="{pos.left}px"
		style:top="{pos.top}px"
		style:visibility={pos.ready ? 'visible' : 'hidden'}
	>
		<div class="tpop-h">
			<span class="tpop-mark"><Mark size={15} /></span>
			<span class="tpop-title">{trust.headline}</span>
		</div>
		<ul class="tpop-checks">
			{#each trust.checks as check (check.id)}
				<li data-state={check.state}>
					<span class="tpop-glyph">
						{#if check.state === 'pass'}
							<Check size={13} />
						{:else if check.state === 'fail'}
							<X size={13} />
						{:else}
							<Minus size={13} />
						{/if}
					</span>
					<span>{check.label}</span>
				</li>
			{/each}
		</ul>
		{#if trust.footnote}
			<p class="tpop-foot">{trust.footnote}</p>
		{/if}
		{#if trust.action === 'confirm_key_change' && onConfirmKeyChange}
			<button class="tpop-act" onclick={confirm} disabled={busy}>
				{busy ? 'Confirming…' : 'Trust the new key'}
			</button>
		{/if}
		{#if trust.technical.length > 0}
			<button class="tpop-more" aria-expanded={tech} onclick={() => (tech = !tech)}>
				<ChevronRight size={13} class={tech ? 'rot' : ''} />
				View technical details
			</button>
			{#if tech}
				<dl class="tpop-tech">
					{#each trust.technical as row, i (row.label + i)}
						<div>
							<dt>{row.label}</dt>
							<dd>{row.value}</dd>
						</div>
					{/each}
				</dl>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.tmark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		border: 1px solid transparent;
		background: transparent;
		font: inherit;
		cursor: pointer;
		padding: 0;
		transition:
			background var(--dur-fast) var(--ease),
			border-color var(--dur-fast) var(--ease);
	}

	.tmark[data-variant='icon'] {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		vertical-align: middle;
		margin-left: 6px;
		flex: 0 0 auto;
	}

	.tmark[data-variant='chip'] {
		font-size: 11px;
		font-weight: 560;
		letter-spacing: 0.01em;
		white-space: nowrap;
		padding: 3px 9px 3px 7px;
		border-radius: var(--radius-pill);
	}

	.tmark :global(svg) {
		flex: 0 0 auto;
	}

	@media (min-width: 641px) {
		@container letterhead (max-width: 470px) {
			.tmark[data-variant='chip'] {
				width: 18px;
				height: 18px;
				padding: 0;
				border-radius: 50%;
			}

			.tmark-label {
				display: none;
			}
		}
	}

	.tmark[data-tier='verified'] {
		background: var(--success-700);
		color: var(--paper-0);
		border-color: var(--success-700);
	}
	.tmark[data-tier='encrypted'] {
		background: var(--success-100);
		color: var(--success-700);
		border-color: color-mix(in oklab, var(--success-500) 22%, transparent);
	}
	.tmark[data-tier='authenticated'] {
		color: var(--success-700);
		border-color: color-mix(in oklab, var(--success-500) 38%, transparent);
	}
	.tmark[data-tier='none'] {
		color: var(--fg-faint);
		border-color: var(--border);
	}
	.tmark[data-tier='attention'] {
		background: var(--warning-100);
		color: var(--warning-700);
		border-color: color-mix(in oklab, var(--warning-500) 26%, transparent);
	}
	.tmark[data-tier='failed'] {
		background: var(--danger-100);
		color: var(--danger-700);
		border-color: color-mix(in oklab, var(--danger-500) 26%, transparent);
	}

	button.tmark:hover {
		border-color: color-mix(in oklab, currentColor 45%, transparent);
	}
	button.tmark:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.tpop-scrim {
		position: fixed;
		inset: 0;
		z-index: 80;
	}

	.tpop {
		position: fixed;
		z-index: 81;
		width: 320px;
		max-width: calc(100vw - 24px);
		max-height: calc(100vh - 24px);
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 14px 16px 15px;
		color: var(--fg);
	}

	.tpop-h {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 11px;
	}

	.tpop-mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		flex: 0 0 auto;
	}
	.tpop[data-tier='verified'] .tpop-mark {
		background: var(--success-700);
		color: var(--paper-0);
	}
	.tpop[data-tier='encrypted'] .tpop-mark {
		background: var(--success-100);
		color: var(--success-700);
	}
	.tpop[data-tier='authenticated'] .tpop-mark {
		color: var(--success-700);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--success-500) 38%, transparent);
	}
	.tpop[data-tier='none'] .tpop-mark {
		color: var(--fg-faint);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.tpop[data-tier='attention'] .tpop-mark {
		background: var(--warning-100);
		color: var(--warning-700);
	}
	.tpop[data-tier='failed'] .tpop-mark {
		background: var(--danger-100);
		color: var(--danger-700);
	}

	.tpop-title {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: var(--track-snug);
		color: var(--fg-strong);
		line-height: 1.25;
	}

	.tpop-checks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.tpop-checks li {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		font-size: 12.5px;
		line-height: 1.35;
	}
	.tpop-checks li[data-state='pass'] {
		color: var(--fg);
	}
	.tpop-checks li[data-state='absent'] {
		color: var(--fg-muted);
	}
	.tpop-checks li[data-state='fail'] {
		color: var(--danger-700);
	}

	.tpop-glyph {
		flex: 0 0 auto;
		margin-top: 1px;
	}
	li[data-state='pass'] .tpop-glyph {
		color: var(--success-700);
	}
	li[data-state='absent'] .tpop-glyph {
		color: var(--fg-faint);
	}
	li[data-state='fail'] .tpop-glyph {
		color: var(--danger-700);
	}

	.tpop-foot {
		margin: 11px 0 0;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.45;
		color: var(--fg-faint);
	}

	.tpop-act {
		margin-top: 12px;
		width: 100%;
		border: 1px solid color-mix(in oklab, var(--warning-500) 40%, transparent);
		background: var(--warning-100);
		color: var(--warning-700);
		font-size: 12.5px;
		font-weight: 560;
		padding: 7px 10px;
		border-radius: var(--radius-md);
		cursor: pointer;
	}
	.tpop-act:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.tpop-more {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 12px;
		padding: 0;
		border: none;
		background: none;
		color: var(--fg-muted);
		font-size: 11.5px;
		font-weight: 540;
		cursor: pointer;
	}
	.tpop-more:hover {
		color: var(--fg-strong);
	}
	.tpop-more :global(svg) {
		transition: transform var(--dur-fast) var(--ease);
	}
	.tpop-more :global(svg.rot) {
		transform: rotate(90deg);
	}

	.tpop-tech {
		margin: 9px 0 0;
		padding: 9px 0 0;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tpop-tech div {
		display: grid;
		grid-template-columns: 108px 1fr;
		gap: 10px;
		align-items: baseline;
	}
	.tpop-tech dt {
		font-size: 11px;
		color: var(--fg-faint);
	}
	.tpop-tech dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 10.5px;
		line-height: 1.45;
		color: var(--fg);
		word-break: break-word;
	}
</style>
