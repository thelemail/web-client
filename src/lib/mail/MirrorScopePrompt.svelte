<script lang="ts">
	import { platform } from '$platform';

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
	<div class="scope-scrim">
		<div class="scope-card">
			<h2>How much mail should this Mac keep?</h2>
			<p>
				Mail kept on this Mac is searchable by its full text and readable without a connection.
				It is stored encrypted, and only this Mac can open it.
			</p>
			<div class="scope-actions">
				<button type="button" class="primary" disabled={busy} onclick={() => choose(90)}>
					Last 90 days
				</button>
				<button type="button" disabled={busy} onclick={() => choose(null)}>All mail</button>
			</div>
			<p class="scope-note">You can change this later in Settings.</p>
		</div>
	</div>
{/if}

<style>
	.scope-scrim {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: color-mix(in oklab, var(--bg-1) 70%, transparent);
		backdrop-filter: blur(6px);
		z-index: 60;
	}
	.scope-card {
		max-width: 30rem;
		padding: 1.75rem;
		border-radius: var(--radius-lg, 12px);
		background: var(--surface-1);
		border: 1px solid var(--border-1);
		box-shadow: var(--shadow-2, 0 12px 40px rgb(0 0 0 / 0.18));
	}
	.scope-card h2 {
		margin: 0 0 0.5rem;
		font-size: 1.15rem;
	}
	.scope-card p {
		margin: 0 0 1rem;
		color: var(--text-2);
		line-height: 1.5;
	}
	.scope-actions {
		display: flex;
		gap: 0.75rem;
	}
	.scope-note {
		margin: 1rem 0 0;
		font-size: 0.85rem;
	}
</style>
