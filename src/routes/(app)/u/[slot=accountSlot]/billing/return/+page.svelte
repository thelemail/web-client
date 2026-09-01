<script lang="ts">
	import { goto } from '$app/navigation';
	import AuthShell from '$lib/auth/AuthShell.svelte';
	import { billing } from '$lib/stores/billing.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { planLabelFor } from '$lib/auth/plans';
	import Mail from '@lucide/svelte/icons/mail';
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	let { data } = $props();

	const slot = $derived(data.slot);
	let phase = $state<'confirming' | 'active' | 'slow'>('confirming');
	let polls = $state(0);

	const planLabel = $derived.by(() => {
		const sub = billing.subscription;
		if (!sub?.planCode) return null;
		return planLabelFor(sub.planCode, sub.seats ?? 1);
	});

	$effect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const tick = async () => {
			if (cancelled) return;
			const sub = await billing.refresh();
			if (cancelled) return;
			if (sub?.entitled && sub.planCode !== 'free') {
				phase = 'active';
				void workspaces.load(auth.accountId);
				return;
			}
			polls += 1;
			if (polls >= 45 && phase === 'confirming') {
				phase = 'slow';
			}
			timer = setTimeout(tick, phase === 'slow' ? 10000 : 2000);
		};

		void tick();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	});
</script>

<svelte:head>
	<title>Thelemail — Confirming payment</title>
</svelte:head>

<AuthShell>
	<div class="card">
		<div class="card-surface screen-fade">
			<div class="welcome">
				{#if phase === 'active'}
					<span class="return-check"><CircleCheck size={44} strokeWidth={1.5} /></span>
					<h1>You&rsquo;re in</h1>
					<p>
						Your subscription is active{#if planLabel}{' '}&mdash;
							<b>{planLabel}</b>{/if}. Welcome to Thelemail.
					</p>
					<div class="actions" style="margin-top:24px">
						<button class="btn btn-primary btn-block" onclick={() => goto(`/u/${slot}/mail/inbox`)}>
							<Mail size={17} strokeWidth={1.75} />Open your mailbox
						</button>
					</div>
				{:else if phase === 'slow'}
					<span class="return-spinner" aria-hidden="true"></span>
					<h1>Taking longer than expected</h1>
					<p>
						Your payment was received &mdash; activation completes automatically as soon as our
						payment provider confirms it. You can keep this page open or check back in a minute.
					</p>
					<div class="actions" style="margin-top:24px">
						<button class="btn btn-secondary btn-block" onclick={() => billing.refresh()}>
							Check again
						</button>
					</div>
				{:else}
					<span class="return-spinner" aria-hidden="true"></span>
					<h1>Confirming your payment&hellip;</h1>
					<p>This usually takes a few seconds. We&rsquo;ll take you to your mailbox automatically.</p>
				{/if}
			</div>
		</div>
	</div>
</AuthShell>

<style>
	.return-check {
		display: inline-flex;
		margin-bottom: 8px;
		color: var(--success-500);
	}
	.return-spinner {
		display: inline-block;
		width: 36px;
		height: 36px;
		margin-bottom: 12px;
		border: 3px solid var(--paper-100);
		border-top-color: var(--pine-700);
		border-radius: 50%;
		animation: return-spin 0.9s linear infinite;
	}
	@keyframes return-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
