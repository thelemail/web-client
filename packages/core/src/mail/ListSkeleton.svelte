<script lang="ts">
	import { m } from '$paraglide/messages.js';

	interface Props {
		rows?: number;
	}

	let { rows = 9 }: Props = $props();

	const WIDTHS = ['62%', '78%', '54%', '70%', '84%', '58%', '74%', '66%', '80%'];
</script>

<div class="lsk" aria-busy="true" role="status">
	<span class="sr-only">{m.mail_list_loading()}</span>
	{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
		<div class="lsk-row" aria-hidden="true">
			<span class="lsk-av"></span>
			<div class="lsk-tx">
				<div class="lsk-top">
					<span class="lsk-bar lsk-from"></span>
					<span class="lsk-bar lsk-when"></span>
				</div>
				<span class="lsk-bar lsk-subj" style:width={WIDTHS[i % WIDTHS.length]}></span>
				<span class="lsk-bar lsk-prev"></span>
			</div>
		</div>
	{/each}
</div>

<style>
	.lsk-row {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr);
		gap: 0 10px;
		padding: 9px 14px 10px 13px;
		border-bottom: 1px solid var(--border);
	}
	.lsk-av {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: color-mix(in oklab, var(--fg-strong) 8%, transparent);
	}
	.lsk-tx {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding-top: 3px;
	}
	.lsk-top {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.lsk-bar {
		display: block;
		height: 9px;
		border-radius: var(--radius-xs);
		background: color-mix(in oklab, var(--fg-strong) 8%, transparent);
		animation: lsk-pulse 1.4s ease-in-out infinite;
	}
	.lsk-from {
		width: 34%;
	}
	.lsk-when {
		width: 44px;
	}
	.lsk-prev {
		width: 88%;
		height: 8px;
		opacity: 0.6;
	}
	@keyframes lsk-pulse {
		50% {
			opacity: 0.5;
		}
	}
	@media (max-width: 1000px) {
		.lsk-row {
			padding: 12px 12px 12px 10px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.lsk-bar {
			animation: none;
		}
	}
</style>
