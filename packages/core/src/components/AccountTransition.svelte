<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { accountTransition } from '$core/stores/accountTransition.svelte';
	import { delayed } from '$core/async/delayed.svelte';

	const current = $derived(accountTransition.current);
	const status = delayed(() => current !== null, { minVisible: 0 });
</script>

{#if current}
	<div class="acct-transition" aria-busy="true">
		{#if status.visible}
			<div class="at-status" role="status">
				<span class="at-spin"></span>
				<span>
					{current.kind === 'signout'
						? m.account_transition_signing_out()
						: current.address
							? m.account_transition_opening({ address: current.address })
							: m.account_transition_opening_plain()}
				</span>
			</div>
		{/if}
	</div>
{/if}

<style>
	.acct-transition {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background);
	}
	.at-status {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-family: var(--font-sans);
		font-size: 13.5px;
		color: var(--fg-muted);
	}
	.at-spin {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 2px solid var(--pine-100);
		border-top-color: var(--pine-600);
		animation: at-spin 0.8s linear infinite;
	}
	@keyframes at-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.at-spin {
			animation: none;
		}
	}
</style>
