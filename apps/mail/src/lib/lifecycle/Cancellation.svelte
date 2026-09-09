<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CircleArrowDown from '@lucide/svelte/icons/circle-arrow-down';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import Check from '@lucide/svelte/icons/check';
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import { billing } from '$lib/stores/billing.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { cancelSubscription, resumeSubscription, changePlan } from '$lib/api/billing';
	import { fmt } from './dates';
	import type { LifecycleContext, RetentionOffer } from './types';
	import { Button } from '$lib/components/ui/button';

	let { ctx, offer = 'cheaper' }: { ctx: LifecycleContext; offer?: RetentionOffer } = $props();

	const slot = $derived(page.params.slot ?? '0');
	const paidThrough = $derived(
		billing.subscription?.currentPeriodEnd ? new Date(billing.subscription.currentPeriodEnd) : ctx.now
	);
	const showOffer = $derived(offer === 'cheaper');

	const REASONS = [
		'Too expensive',
		'Not using it enough',
		'Missing a feature I need',
		'Switching to another provider',
		'Just taking a break',
		'Other'
	];

	let step = $state(0);
	let reason = $state<string | null>(null);
	let clicks = $state(0);
	let busy = $state(false);
	const bump = () => (clicks += 1);

	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	function flash(message: string) {
		toast = message;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 2600);
	}

	function toConfirm() {
		bump();
		step = showOffer ? 1 : 2;
	}

	async function confirmCancel() {
		if (busy) return;
		busy = true;
		try {
			await cancelSubscription();
			await billing.refresh();
			if (auth.accountId) await auth.loadProfile(auth.accountId);
			bump();
			step = 3;
		} catch {
			flash('Could not cancel just now. Please try again.');
		} finally {
			busy = false;
		}
	}

	async function keepPlan(message: string) {
		if (busy) return;
		busy = true;
		try {
			if (billing.subscription?.cancelAtPeriodEnd) await resumeSubscription();
			await billing.refresh();
			if (auth.accountId) await auth.loadProfile(auth.accountId);
			flash(message);
			void goto(`/u/${slot}/mail/inbox`);
		} catch {
			flash('Could not update your plan. Please try again.');
		} finally {
			busy = false;
		}
	}

	async function acceptCheaper() {
		if (busy) return;
		busy = true;
		try {
			await changePlan({ planCode: 'personal' });
			await billing.refresh();
			flash('Moved to Personal. Your plan is kept.');
			void goto(`/u/${slot}/mail/inbox`);
		} catch {
			flash('Could not switch plans. Please try again.');
		} finally {
			busy = false;
		}
	}
</script>

{#if step === 0}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">Cancel plan</p>
				<h1>Before you go</h1>
				<p>One quick question — it helps us improve. You can skip it.</p>
			</div>
			<div class="lc-survey">
				{#each REASONS as r (r)}
					<button
						type="button"
						class="lc-survey-opt"
						class:sel={reason === r}
						onclick={() => (reason = r)}
					>
						<span class="rd"><i></i></span><span>{r}</span>
					</button>
				{/each}
			</div>
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label="Back" onclick={() => goto(`/u/${slot}/mail/inbox`)}>
						<ArrowLeft />
					</Button>
					<Button variant="primary" size="lg" onclick={toConfirm}>
						Continue<ArrowRight />
					</Button>
				</div>
			</div>
			<p class="legal">
				Cancelling is always available here in <b>Settings → Billing</b>. No phone call, no retention
				maze.
			</p>
		</div>
	</div>
{:else if step === 1}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head"><p class="eyebrow">Cancel plan</p><h1>One thing before you confirm</h1></div>
			<div class="lc-offer">
				<span class="of-ic"><CircleArrowDown size={22} /></span>
				<span class="of-tx"
					><b>Move to Personal instead?</b><p>
						Stay on a smaller plan rather than leaving. Your archive stays put; you just pay less. You
						can move back up any time.
					</p></span
				>
			</div>
			<div class="actions" style="margin-top:18px">
				<Button variant="primary" size="lg" block disabled={busy} onclick={acceptCheaper}>
					<CircleArrowDown size={17} />Switch to Personal
				</Button>
				<Button variant="ghost" size="lg" block onclick={() => (bump(), (step = 2))}>
					No thanks, continue cancelling
				</Button>
			</div>
		</div>
	</div>
{:else if step === 2}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">Cancel plan</p>
				<h1>Confirm cancellation</h1>
				<p>Here's what happens, and when. Nothing is deleted for months.</p>
			</div>
			<ul class="lc-confirm-dates">
				<li>
					<span class="cd-dt">{fmt.med(paidThrough)}</span>
					<span class="cd-tx"
						><b>Paid through this date.</b> Full access until then — change your mind any time.</span
					>
				</li>
				<li>
					<span class="cd-dt">then read-only</span>
					<span class="cd-tx"><b>Still receiving mail;</b> sending and editing paused.</span>
				</li>
				<li>
					<span class="cd-dt">months later</span>
					<span class="cd-tx"
						><b>Data is kept</b> for a long grace period, then deleted. We email you the exact dates and
						a one-click restore link.</span
					>
				</li>
			</ul>
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label="Back" onclick={() => (step = showOffer ? 1 : 0)}>
						<ArrowLeft />
					</Button>
					<Button variant="dangerSolid" size="lg" disabled={busy} onclick={confirmCancel}>
						<CircleX />Cancel my plan
					</Button>
				</div>
			</div>
			<p class="legal">Annual plans run to the period end, then follow the timeline above.</p>
		</div>
	</div>
{:else}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="welcome">
				<div class="seal"><Check size={20} /></div>
				<h1>Your plan is cancelled.</h1>
				<p>You're paid through <b>{fmt.med(paidThrough)}</b>. Nothing changes until then.</p>
			</div>
			<div class="lc-mail-confirm">
				<MailCheck size={18} />
				<span
					>A confirmation is on its way to <span class="mono">{ctx.email}</span> — with your dates and
					a one-click restore link.</span
				>
			</div>
			<div class="actions" style="margin-top:22px">
				<Button variant="primary" size="lg" block onclick={() => goto(`/u/${slot}/mail/inbox`)}>
					<ArrowLeft />Back to your mailbox
				</Button>
				<Button variant="ghost" size="lg" block disabled={busy} onclick={() => keepPlan('Plan kept. Nothing changed.')}>
					Actually, keep my plan
				</Button>
			</div>
			<p class="lc-clickcount">Cancelled in {clicks} clicks · always this easy to find</p>
		</div>
	</div>
{/if}

{#if toast}
	<div class="lc-toast"><CircleCheck size={16} />{toast}</div>
{/if}
