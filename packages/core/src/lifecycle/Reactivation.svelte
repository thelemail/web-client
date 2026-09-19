<script lang="ts">
	import { goto } from '$app/navigation';
	import { platform } from '$platform';
	import { page } from '$app/state';
	import mark from '$core/assets/logo-mark.svg';
	import Database from '@lucide/svelte/icons/database';
	import Check from '@lucide/svelte/icons/check';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Zap from '@lucide/svelte/icons/zap';
	import Lock from '@lucide/svelte/icons/lock';
	import Mail from '@lucide/svelte/icons/mail';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Clock from '@lucide/svelte/icons/clock';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import CornerUpLeft from '@lucide/svelte/icons/corner-up-left';
	import UserRound from '@lucide/svelte/icons/user-round';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import BriefcaseBusiness from '@lucide/svelte/icons/briefcase-business';
	import { auth } from '$core/stores/auth.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { createCheckoutSession, createBillingPortalSession } from '$core/api/billing';
	import { ApiCallError } from '$core/api/types';
	import { eur, planTotal, selectionForCode, type BillingPeriod } from '$core/auth/plans';
	import { fmt } from './dates';
	import type { LifecycleContext, ReactivationPlan } from './types';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';

	let { ctx }: { ctx: LifecycleContext } = $props();

	const slot = $derived(page.params.slot ?? '0');
	const PLAN_ICONS: Record<string, typeof UserRound> = {
		'user-round': UserRound,
		'users-round': UsersRound,
		'briefcase-business': BriefcaseBusiness
	};

	const RE_PLANS: ReactivationPlan[] = $derived([
		{
			id: 'personal',
			name: m.lc_restore_plan_personal(),
			gb: 15,
			icon: 'user-round',
			framing: m.lc_restore_framing_personal(),
			rows: [
				[m.lc_restore_row_mailboxes(), '1'],
				[m.lc_restore_row_storage(), m.lc_restore_gb({ gb: 15 })],
				[m.lc_restore_row_custom_domains(), '1']
			]
		},
		{
			id: 'personal_plus',
			name: m.lc_restore_plan_personal_plus(),
			gb: 50,
			icon: 'user-round',
			framing: m.lc_restore_framing_personal_plus(),
			rows: [
				[m.lc_restore_row_mailboxes(), '1'],
				[m.lc_restore_row_storage(), m.lc_restore_gb({ gb: 50 })],
				[m.lc_restore_row_custom_domains(), '3']
			]
		},
		{
			id: 'family',
			name: m.lc_restore_plan_family(),
			gb: 60,
			icon: 'users-round',
			badge: m.lc_restore_badge_your_plan(),
			framing: m.lc_restore_framing_family(),
			rows: [
				[m.lc_restore_row_mailboxes(), m.lc_restore_up_to({ count: 6 })],
				[m.lc_restore_row_storage(), m.lc_restore_gb_pooled({ gb: 60 })],
				[m.lc_restore_row_custom_domains(), '2']
			]
		},
		{
			id: 'business',
			name: m.lc_restore_plan_business(),
			gb: 100,
			icon: 'briefcase-business',
			framing: m.lc_restore_framing_business(),
			rows: [
				[m.lc_restore_row_mailboxes(), m.lc_restore_per_seat()],
				[m.lc_restore_row_storage(), m.lc_restore_gb_each({ gb: 100 })],
				[m.lc_restore_row_custom_domains(), m.lc_restore_up_to({ count: 10 })]
			]
		}
	]);

	const stored = $derived(ctx.plan.mailboxGB);
	const locked = (p: ReactivationPlan) => p.gb < stored;

	let tier = $state<string>('family');
	let step = $state(0);
	let busy = $state(false);
	let notice = $state<string | null>(null);

	const effectiveTier = $derived.by(() => {
		const chosen = RE_PLANS.find((p) => p.id === tier);
		if (chosen && !locked(chosen)) return tier;
		return (RE_PLANS.find((p) => !locked(p)) ?? RE_PLANS[2]).id;
	});
	const sel = $derived(RE_PLANS.find((p) => p.id === effectiveTier) ?? RE_PLANS[2]);

	let period = $state<BillingPeriod>('year');
	const monthly = $derived(period === 'month');
	const periodWord = $derived(monthly ? m.lc_restore_period_month() : m.lc_restore_period_year());

	function priceOf(plan: ReactivationPlan): number {
		const selection = selectionForCode(plan.id, 1, period);
		return selection ? planTotal(selection) : 0;
	}
	const selPrice = $derived(priceOf(sel));

	async function pay() {
		if (busy) return;
		busy = true;
		notice = null;
		try {
			const sub = billing.subscription;
			if (sub?.entitled) {
				await enterMailbox();
				return;
			}
			const origin = platform.returnOrigin();
			if (sub?.status === 'past_due') {
				const { url } = await createBillingPortalSession({
					returnUrl: `${origin}/u/${slot}/billing/return`
				});
				platform.openExternal(url);
				return;
			}
			const { url } = await createCheckoutSession({
				planCode: sel.id,
				interval: period,
				successUrl: `${origin}/u/${slot}/billing/return`,
				cancelUrl: `${origin}/u/${slot}/lifecycle/restore`
			});
			platform.openExternal(url);
		} catch (err) {
			if (err instanceof ApiCallError && err.status === 409) {
				await enterMailbox();
				return;
			}
			busy = false;
			notice = restoreErrorMessage(err);
		}
	}
	function restoreErrorMessage(err: unknown): string {
		if (err instanceof ApiCallError) {
			if (err.status === 402) return m.lc_restore_error_managed_elsewhere();
			if (err.status === 404) return m.lc_restore_error_no_payment_method();
			const message = err.envelope?.error?.message;
			if (message) return message;
		}
		return m.lc_restore_error_generic();
	}
	async function enterMailbox() {
		if (auth.accountId) await auth.loadProfile(auth.accountId);
		void goto(`/u/${slot}/mail/inbox`);
	}
</script>

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

{#if step === 0}
	<div class="card">
		<div class="card-surface wide screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_restore_eyebrow()}</p>
				<h1>{m.lc_restore_choose_title()}</h1>
				<p>{m.lc_restore_choose_intro()}</p>
			</div>
			<div class="lc-stored">
				<span class="si"><Database size={18} /></span>
				<span class="st">
					<Rich text={m.lc_restore_stored({ gb: stored })} tags={{ b: bold }} />
				</span>
			</div>
			<div class="tiers">
				<div class="periodtabs" role="radiogroup" aria-label={m.lc_restore_period_label()}>
					<button
						type="button"
						role="radio"
						aria-checked={!monthly}
						class="periodtab"
						class:cur={!monthly}
						onclick={() => (period = 'year')}
					>
						{m.lc_restore_period_annual()}
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={monthly}
						class="periodtab"
						class:cur={monthly}
						onclick={() => (period = 'month')}
					>
						{m.lc_restore_period_monthly()}
					</button>
				</div>
				{#each RE_PLANS as p (p.id)}
					{@const lk = locked(p)}
					<button
						type="button"
						class="tiercard"
						class:sel={p.id === effectiveTier}
						class:locked={lk}
						disabled={lk}
						onclick={() => !lk && (tier = p.id)}
					>
						{#if p.badge}<span class="mostbadge">{p.badge}</span>{/if}
						<span class="tc-pick" aria-hidden="true"><Check size={13} /></span>
						<span class="tc-name">{p.name}</span>
						<span class="tc-framing serif">{p.framing}</span>
						<span class="tc-price"><b class="serif">{eur(priceOf(p))}</b><span class="tc-per mono"
								>{m.lc_restore_per_period({ period: periodWord })}</span
							></span
						>
						<span class="tc-rows">
							{#each p.rows as [k, v] (k)}
								<span class="trow"><span class="tk">{k}</span><span class="tv mono">{v}</span></span>
							{/each}
						</span>
						{#if lk}
							<span class="lc-lock-note">
								<Lock size={14} />{m.lc_restore_lock_note({ stored, gb: p.gb })}
							</span>
						{/if}
					</button>
				{/each}
			</div>
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} onclick={() => goto(`/u/${slot}/mail/inbox`)}>
						<ArrowLeft />
					</Button>
					<Button variant="primary" size="lg" onclick={() => (step = 1)}>
						{m.lc_restore_continue({ plan: sel.name, price: eur(selPrice), period: periodWord })}<ArrowRight />
					</Button>
				</div>
			</div>
			<p class="legal">
				{m.lc_restore_legal()}
			</p>
		</div>
	</div>
{:else if step === 1}
	{@const SelIcon = PLAN_ICONS[sel.icon]}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_restore_eyebrow()}</p>
				<h1>{m.lc_restore_confirm_title()}</h1>
			</div>
			<div class="osum">
				<span class="os-ic"><SelIcon size={17} /></span>
				<span class="os-text">
					<span class="os-name">{m.lc_restore_plan_name({ plan: sel.name })}</span>
					<span class="os-sub"
						>{monthly
							? m.lc_restore_billed_monthly({ gb: stored })
							: m.lc_restore_billed_yearly({ gb: stored })}</span
					>
				</span>
				<span class="os-right">
					<span class="os-price mono"
						>{m.lc_restore_price_period({ price: eur(selPrice), period: periodWord })}</span
					>
					<button class="os-change" onclick={() => (step = 0)}>{m.lc_restore_change()}</button>
				</span>
			</div>
			<div class="osum" style="margin-bottom:18px">
				<span class="os-ic"><CreditCard size={17} /></span>
				<span class="os-text">
					<span class="os-name">{m.lc_restore_checkout_title()}</span>
					<span class="os-sub">{m.lc_restore_checkout_detail()}</span>
				</span>
			</div>
			{#if notice}
				<p class="lc-restore-notice"><CircleAlert size={15} />{notice}</p>
			{/if}
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} onclick={() => (step = 0)} disabled={busy}>
						<ArrowLeft />
					</Button>
					<Button variant="primary" size="lg" disabled={busy} onclick={pay}>
						{#if busy}<span class="spinner"></span>{m.lc_restore_busy()}{:else}<RotateCcw />{m.lc_restore_pay(
								{ price: eur(selPrice) }
							)}{/if}
					</Button>
				</div>
			</div>
			<p class="cardnote">
				<Zap size={14} />{m.lc_restore_instant()}
			</p>
		</div>
	</div>
{:else}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="welcome">
				<img class="brandmark brandmark-lg" src={mark} alt="Thelemail" />
				<h1>{m.lc_restore_welcome_title()}</h1>
				<p>{m.lc_restore_welcome_intro()}</p>
			</div>
			<ul class="lc-welcome-truths">
				{#if ctx.cameFromSuspended}
					<li>
						<CornerUpLeft size={16} />
						<span
							><Rich
								text={m.lc_restore_truth_returned({ date: fmt.med(ctx.dates.suspend) })}
								tags={{ b: bold }}
							/></span
						>
					</li>
				{:else}
					<li>
						<Inbox size={16} />
						<span><Rich text={m.lc_restore_truth_arrived()} tags={{ b: bold }} /></span>
					</li>
				{/if}
				<li>
					<Clock size={16} />
					<span><Rich text={m.lc_restore_truth_scheduled()} tags={{ b: bold }} /></span>
				</li>
				<li>
					<BellRing size={16} />
					<span><Rich text={m.lc_restore_truth_newsletters()} tags={{ b: bold }} /></span>
				</li>
			</ul>
			<div class="actions" style="margin-top:22px">
				<Button variant="primary" size="lg" block onclick={enterMailbox}>
					<Mail />{m.lc_restore_enter_mailbox()}
				</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.lc-restore-notice {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 0 0 16px;
		padding: 11px 14px;
		border: 1px solid var(--danger-500, #b5453a);
		border-radius: var(--radius-md, 8px);
		background: color-mix(in srgb, var(--danger-500, #b5453a) 8%, transparent);
		font-size: var(--text-sm, 13px);
		color: var(--ink-700, #3a4032);
	}
	.lc-restore-notice :global(svg) {
		flex-shrink: 0;
		margin-top: 1px;
		color: var(--danger-500, #b5453a);
	}
</style>
