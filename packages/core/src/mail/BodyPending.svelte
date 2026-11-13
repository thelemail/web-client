<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import Lock from '@lucide/svelte/icons/lock';

	const LINES: (string | null)[] = ['96%', '100%', '89%', '71%', null, '93%', '100%', '82%', '58%'];
</script>

<div class="bp" aria-busy="true">
	<div class="bp-status" role="status">
		<span class="bp-spin"></span>
		<Lock size={13} />
		<span>{m.mail_skeleton_decrypting()}</span>
	</div>
	<div class="bp-lines" aria-hidden="true">
		{#each LINES as w, i (i)}
			{#if w === null}
				<div class="bp-gap"></div>
			{:else}
				<div class="bp-line" style:width={w}></div>
			{/if}
		{/each}
	</div>
</div>

<style>
	.bp {
		padding: 4px 0 8px;
	}
	.bp-status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		letter-spacing: 0.02em;
		color: var(--ink-500);
		margin-bottom: 20px;
	}
	.bp-status :global(svg) {
		color: var(--brass-600);
	}
	.bp-spin {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid var(--pine-100);
		border-top-color: var(--pine-600);
		animation: bp-spin 0.8s linear infinite;
		flex: 0 0 auto;
	}
	.bp-line {
		height: 13px;
		margin-bottom: 13px;
		border-radius: 5px;
		background: var(--paper-150);
		animation: bp-pulse 1.6s ease infinite;
	}
	.bp-gap {
		height: 14px;
	}
	@keyframes bp-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes bp-pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bp-spin {
			animation: none;
			border-top-color: var(--pine-300);
		}
		.bp-line {
			animation: none;
		}
	}
</style>
