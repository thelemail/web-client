<script lang="ts">
	import { platform } from '$platform';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		accountId: string;
	}

	let { accountId }: Props = $props();

	let asking = $state(false);
	let busy = $state(false);

	$effect(() => {
		const mirror = platform.mirror;
		if (!mirror) return;
		let cancelled = false;
		void mirror
			.scope(accountId)
			.then((chosen) => {
				if (!cancelled) asking = chosen === null;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	async function choose(days: number | null) {
		const mirror = platform.mirror;
		if (!mirror || busy) return;
		busy = true;
		const floor =
			days === null
				? 'all'
				: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
		try {
			await mirror.setScope(accountId, floor);
			asking = false;
		} finally {
			busy = false;
		}
	}
</script>

{#if asking}
	<div class="msp-scrim" role="dialog" aria-modal="true" aria-labelledby="msp-title">
		<div class="msp-modal">
			<h2 id="msp-title">How much mail should this Mac keep?</h2>
			<p>
				Mail kept on this Mac is searchable by its full text and readable without a
				connection. It is stored encrypted, and only this Mac can open it.
			</p>
			<div class="msp-actions">
				<Button variant="primary" disabled={busy} onclick={() => choose(90)}>
					Last 90 days
				</Button>
				<Button variant="secondary" disabled={busy} onclick={() => choose(null)}>
					All mail
				</Button>
			</div>
			<p class="msp-note">You can change this later in Settings.</p>
		</div>
	</div>
{/if}

<style>
	.msp-scrim {
		position: fixed;
		inset: 0;
		z-index: 130;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: rgba(20, 39, 30, 0.44);
		backdrop-filter: blur(3px);
		font-family: var(--font-sans);
		color: var(--fg);
	}

	.msp-modal {
		width: 466px;
		max-width: 100%;
		background: var(--surface);
		border: 1px solid var(--border);
		border-top: 3px solid var(--pine-600);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		padding: 22px 24px 18px;
	}

	.msp-modal h2 {
		margin: 0 0 8px;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.msp-modal p {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--fg-muted);
	}

	.msp-actions {
		display: flex;
		gap: 10px;
		margin-top: 20px;
	}

	.msp-note {
		margin-top: 14px;
		font-size: 12.5px;
	}
</style>
