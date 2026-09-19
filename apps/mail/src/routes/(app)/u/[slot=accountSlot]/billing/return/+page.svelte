<script lang="ts">
	import { goto } from '$app/navigation';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { planLabelFor } from '$core/auth/plans';
	import Mail from '@lucide/svelte/icons/mail';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';

	let { data } = $props();

	const slot = $derived(data.slot);
	let phase = $state<'confirming' | 'active' | 'slow'>('confirming');
	let polls = $state(0);

	const planLabel = $derived.by(() => {
		const sub = billing.subscription;
		if (!sub?.planCode) return null;
		return planLabelFor(sub.planCode, sub.seats ?? 1, sub.interval ?? 'year');
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
	<title>{m.billing_return_page_title()}</title>
</svelte:head>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<AuthShell>
	<div class="card">
		<div class="card-surface screen-fade">
			<div class="welcome">
				{#if phase === 'active'}
					<span class="return-check"><CircleCheck size={44} strokeWidth={1.5} /></span>
					<h1>{m.billing_return_active_title()}</h1>
					<p>
						{#if planLabel}
							<Rich text={m.billing_return_active_plan({ plan: planLabel })} tags={{ b: bold }} />
						{:else}
							{m.billing_return_active()}
						{/if}
					</p>
					<div class="actions" style="margin-top:24px">
						<Button variant="primary" size="lg" block onclick={() => goto(`/u/${slot}/mail/inbox`)}>
							<Mail size={17} strokeWidth={1.75} />{m.billing_open_mailbox()}
						</Button>
					</div>
				{:else if phase === 'slow'}
					<span class="return-spinner" aria-hidden="true"></span>
					<h1>{m.billing_return_slow_title()}</h1>
					<p>
						{m.billing_return_slow_body()}
					</p>
					<div class="actions" style="margin-top:24px">
						<Button variant="secondary" size="lg" block onclick={() => billing.refresh()}>
							{m.billing_return_check_again()}
						</Button>
					</div>
				{:else}
					<span class="return-spinner" aria-hidden="true"></span>
					<h1>{m.billing_return_confirming_title()}</h1>
					<p>{m.billing_return_confirming_body()}</p>
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
