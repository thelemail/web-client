<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	interface Props {
		onBack?: () => void;
	}

	let { onBack }: Props = $props();

	const BODY: (string | null)[] = [
		'96%',
		'100%',
		'89%',
		'71%',
		null,
		'93%',
		'100%',
		'82%',
		'58%',
		null,
		'90%',
		'66%'
	];
</script>

<section class="reader" aria-busy="true">
	<div class="reader-bar sk-bar">
		<button class="rb-ico rb-back" title="Back to list" onclick={() => onBack?.()}>
			<ArrowLeft size={17} />
		</button>
		<span class="sk sk-pill" style="width:86px"></span>
		<span class="sk sk-pill" style="width:94px"></span>
		<span class="sk sk-pill" style="width:90px"></span>
		<div class="grow"></div>
		<span class="sk sk-sq"></span>
		<span class="sk sk-sq"></span>
		<span class="sk sk-sq"></span>
	</div>
	<div class="reader-scroll">
		<div class="reader-inner">
			<div class="sk-status" role="status">
				<span class="sk-spin"></span>
				<Lock size={13} />
				<span>Decrypting message…</span>
			</div>
			<div class="reader-h sk-h">
				<div class="sk sk-title" style="width:84%"></div>
				<div class="sk sk-title" style="width:51%; margin-top:11px"></div>
			</div>
			<div class="sk-meta">
				<div class="sk sk-av"></div>
				<div class="sk-meta-tx">
					<div class="sk sk-line" style="width:130px; height:14px"></div>
					<div class="sk sk-line" style="width:198px; height:12px; margin-top:8px"></div>
				</div>
				<div class="sk sk-line sk-when" style="width:66px; height:12px"></div>
			</div>
			<div class="sk-body">
				{#each BODY as w, i (i)}
					{#if w === null}
						<div class="sk-gap"></div>
					{:else}
						<div class="sk sk-line tall" style="width:{w}"></div>
					{/if}
				{/each}
			</div>
		</div>
	</div>
</section>

<style>
	.sk {
		position: relative;
		overflow: hidden;
		background: var(--paper-150, #ece4d0);
		border-radius: 4px;
	}
	.sk::after {
		content: '';
		position: absolute;
		inset: 0;
		transform: translateX(-100%);
		background: linear-gradient(
			90deg,
			transparent 0,
			color-mix(in srgb, var(--surface, #faf7eb) 78%, transparent) 50%,
			transparent 100%
		);
		animation: sk-sweep 1.5s ease infinite;
	}
	@keyframes sk-sweep {
		100% {
			transform: translateX(100%);
		}
	}

	.reader-bar.sk-bar {
		pointer-events: none;
	}
	.sk-bar .rb-back {
		pointer-events: auto;
	}
	.sk-bar .sk-pill {
		height: 33px;
		border-radius: 8px;
	}
	.sk-bar .sk-sq {
		width: 35px;
		height: 35px;
		border-radius: 8px;
	}

	.sk-status {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace);
		font-size: 11.5px;
		letter-spacing: 0.02em;
		color: var(--ink-500, #6b7360);
		margin-bottom: 26px;
	}
	.sk-status :global(svg) {
		width: 13px;
		height: 13px;
		color: var(--brass-600, #a87c3d);
	}
	.sk-spin {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid var(--pine-100, #d4e3d6);
		border-top-color: var(--pine-600, #2e5440);
		animation: svspin 0.8s linear infinite;
		flex: 0 0 auto;
	}
	@keyframes svspin {
		to {
			transform: rotate(360deg);
		}
	}

	.sk-h .sk-title {
		height: 27px;
		border-radius: 6px;
	}

	.sk-meta {
		display: flex;
		align-items: center;
		gap: 13px;
		margin: 24px 0 20px;
	}
	.sk-meta .sk-av {
		width: 46px;
		height: 46px;
		border-radius: var(--radius-avatar);
		flex: 0 0 auto;
	}
	.sk-meta-tx {
		flex: 1 1 auto;
		min-width: 0;
	}
	.sk-meta .sk-when {
		margin-left: auto;
		flex: 0 0 auto;
	}

	.sk-body {
		border-top: 1px solid var(--border, #e6dfcd);
		padding-top: 24px;
	}
	.sk-body .sk-line.tall {
		height: 13px;
		margin-bottom: 13px;
		border-radius: 5px;
	}
	.sk-body .sk-gap {
		height: 14px;
	}

	@media (prefers-reduced-motion: reduce) {
		.sk::after {
			animation: none;
		}
		.sk {
			animation: sk-pulse 1.6s ease infinite;
		}
		.sk-spin {
			animation: none;
			border-top-color: var(--pine-300, #aac3ab);
		}
	}
	@keyframes sk-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
</style>
