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
	import { billing } from '$core/stores/billing.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { cancelSubscription, resumeSubscription, changePlan } from '$core/api/billing';
	import { entryPointVisible } from './downgrade';
	import { fmt } from './dates';
	import type { LifecycleContext, RetentionOffer } from './types';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';

	let { ctx, offer = 'cheaper' }: { ctx: LifecycleContext; offer?: RetentionOffer } = $props();

	const slot = $derived(page.params.slot ?? '0');
	const paidThrough = $derived(
		billing.subscription?.currentPeriodEnd ? new Date(billing.subscription.currentPeriodEnd) : ctx.now
	);
	const showOffer = $derived(offer === 'cheaper');
	const canMoveToFree = $derived(entryPointVisible(billing.subscription));

	const REASONS: { id: string; label: () => string }[] = [
		{ id: 'too_expensive', label: m.lc_cancel_reason_too_expensive },
		{ id: 'not_using', label: m.lc_cancel_reason_not_using },
		{ id: 'missing_feature', label: m.lc_cancel_reason_missing_feature },
		{ id: 'switching', label: m.lc_cancel_reason_switching },
		{ id: 'break', label: m.lc_cancel_reason_break },
		{ id: 'other', label: m.lc_cancel_reason_other }
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
			flash(m.lc_cancel_failed());
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
			flash(m.lc_cancel_update_failed());
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
			flash(m.lc_cancel_moved_personal());
			void goto(`/u/${slot}/mail/inbox`);
		} catch {
			flash(m.lc_cancel_switch_failed());
		} finally {
			busy = false;
		}
	}
</script>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}
{#snippet mono(text: string)}<span class="mono">{text}</span>{/snippet}

{#if step === 0}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_cancel_eyebrow()}</p>
				<h1>{m.lc_cancel_survey_title()}</h1>
				<p>{m.lc_cancel_survey_intro()}</p>
			</div>
			<div class="lc-survey">
				{#each REASONS as r (r.id)}
					<button
						type="button"
						class="lc-survey-opt"
						class:sel={reason === r.id}
						onclick={() => (reason = r.id)}
					>
						<span class="rd"><i></i></span><span>{r.label()}</span>
					</button>
				{/each}
			</div>
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} onclick={() => goto(`/u/${slot}/mail/inbox`)}>
						<ArrowLeft />
					</Button>
					<Button variant="primary" size="lg" onclick={toConfirm}>
						{m.common_continue()}<ArrowRight />
					</Button>
				</div>
			</div>
			<p class="legal">
				<Rich text={m.lc_cancel_survey_legal()} tags={{ b: bold }} />
			</p>
		</div>
	</div>
{:else if step === 1}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_cancel_eyebrow()}</p>
				<h1>{m.lc_cancel_offer_title()}</h1>
			</div>
			<div class="lc-offer">
				<span class="of-ic"><CircleArrowDown size={22} /></span>
				<span class="of-tx"
					><b>{m.lc_cancel_offer_heading()}</b><p>
						{m.lc_cancel_offer_body()}
					</p></span
				>
			</div>
			<div class="actions" style="margin-top:18px">
				<Button variant="primary" size="lg" block disabled={busy} onclick={acceptCheaper}>
					<CircleArrowDown size={17} />{m.lc_cancel_offer_accept()}
				</Button>
				{#if canMoveToFree}
					<Button
						variant="secondary"
						size="lg"
						block
						href={`/u/${slot}/lifecycle/downgrade`}
					>
						{m.lc_cancel_offer_free()}
					</Button>
				{/if}
				<Button variant="ghost" size="lg" block onclick={() => (bump(), (step = 2))}>
					{m.lc_cancel_offer_decline()}
				</Button>
			</div>
		</div>
	</div>
{:else if step === 2}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_cancel_eyebrow()}</p>
				<h1>{m.lc_cancel_confirm_title()}</h1>
				<p>{m.lc_cancel_confirm_intro()}</p>
			</div>
			<ul class="lc-confirm-dates">
				<li>
					<span class="cd-dt">{fmt.med(paidThrough)}</span>
					<span class="cd-tx"><Rich text={m.lc_cancel_confirm_paid()} tags={{ b: bold }} /></span>
				</li>
				<li>
					<span class="cd-dt">{m.lc_cancel_confirm_then_read_only()}</span>
					<span class="cd-tx"><Rich text={m.lc_cancel_confirm_read_only()} tags={{ b: bold }} /></span>
				</li>
				<li>
					<span class="cd-dt">{m.lc_cancel_confirm_months_later()}</span>
					<span class="cd-tx"><Rich text={m.lc_cancel_confirm_kept()} tags={{ b: bold }} /></span>
				</li>
			</ul>
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} onclick={() => (step = showOffer ? 1 : 0)}>
						<ArrowLeft />
					</Button>
					<Button variant="dangerSolid" size="lg" disabled={busy} onclick={confirmCancel}>
						<CircleX />{m.lc_cancel_confirm_submit()}
					</Button>
				</div>
			</div>
			<p class="legal">{m.lc_cancel_confirm_legal()}</p>
		</div>
	</div>
{:else}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="welcome">
				<div class="seal"><Check size={20} /></div>
				<h1>{m.lc_cancel_done_title()}</h1>
				<p><Rich text={m.lc_cancel_done_paid({ date: fmt.med(paidThrough) })} tags={{ b: bold }} /></p>
			</div>
			<div class="lc-mail-confirm">
				<MailCheck size={18} />
				<span><Rich text={m.lc_cancel_done_email({ email: ctx.email })} tags={{ email: mono }} /></span>
			</div>
			<div class="actions" style="margin-top:22px">
				<Button variant="primary" size="lg" block onclick={() => goto(`/u/${slot}/mail/inbox`)}>
					<ArrowLeft />{m.lc_back_to_your_mailbox()}
				</Button>
				<Button variant="ghost" size="lg" block disabled={busy} onclick={() => keepPlan(m.lc_cancel_plan_kept())}>
					{m.lc_cancel_done_keep()}
				</Button>
			</div>
			<p class="lc-clickcount">{m.lc_cancel_done_clicks({ count: clicks })}</p>
		</div>
	</div>
{/if}

{#if toast}
	<div class="lc-toast"><CircleCheck size={16} />{toast}</div>
{/if}
