<script lang="ts">
	import { goto } from '$app/navigation';
	import { platform } from '$platform';
	import { page } from '$app/state';
	import mark from '$lib/assets/logo-mark.svg';
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
	import { auth } from '$lib/stores/auth.svelte';
	import { billing } from '$lib/stores/billing.svelte';
	import { createCheckoutSession, createBillingPortalSession } from '$lib/api/billing';
	import { ApiCallError } from '$lib/api/types';
	import { eur, planTotal, selectionForCode, type BillingPeriod } from '$lib/auth/plans';
	import { fmt } from './dates';
	import type { LifecycleContext, ReactivationPlan } from './types';
	import { Button } from '$lib/components/ui/button';

	let { ctx }: { ctx: LifecycleContext } = $props();

	const slot = $derived(page.params.slot ?? '0');
	const PLAN_ICONS: Record<string, typeof UserRound> = {
		'user-round': UserRound,
		'users-round': UsersRound,
		'briefcase-business': BriefcaseBusiness
	};

	const RE_PLANS: ReactivationPlan[] = [
		{
			id: 'personal',
			name: 'Personal',
			gb: 15,
			icon: 'user-round',
			framing: 'A private mailbox of your own.',
			rows: [
				['Mailboxes', '1'],
				['Storage', '15 GB'],
				['Custom domains', '1']
			]
		},
		{
			id: 'personal_plus',
			name: 'Personal Plus',
			gb: 50,
			icon: 'user-round',
			framing: 'Room for a deep archive.',
			rows: [
				['Mailboxes', '1'],
				['Storage', '50 GB'],
				['Custom domains', '3']
			]
		},
		{
			id: 'family',
			name: 'Family',
			gb: 60,
			icon: 'users-round',
			badge: 'Your plan',
			framing: 'The whole household, one price.',
			rows: [
				['Mailboxes', 'Up to 6'],
				['Storage', '60 GB pooled'],
				['Custom domains', '2']
			]
		},
		{
			id: 'business',
			name: 'Business',
			gb: 100,
			icon: 'briefcase-business',
			framing: 'For studios and teams.',
			rows: [
				['Mailboxes', 'Per seat'],
				['Storage', '100 GB each'],
				['Custom domains', 'Up to 10']
			]
		}
	];

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
			if (err.status === 402)
				return 'This plan is managed elsewhere. Update it from Settings → Billing.';
			if (err.status === 404) return 'No payment method on file. Contact support to restore.';
			const message = err.envelope?.error?.message;
			if (message) return message;
		}
		return 'Could not restore just now. Please try again.';
	}
	async function enterMailbox() {
		if (auth.accountId) await auth.loadProfile(auth.accountId);
		void goto(`/u/${slot}/mail/inbox`);
	}
</script>

{#if step === 0}
	<div class="card">
		<div class="card-surface wide screen-fade">
			<div class="card-head">
				<p class="eyebrow">Restore your account</p>
				<h1>Choose a plan to restore</h1>
				<p>Your mailbox and everything in it comes back exactly as you left it.</p>
			</div>
			<div class="lc-stored">
				<span class="si"><Database size={18} /></span>
				<span class="st">
					Your mailbox holds <b>{stored} GB</b>. Restore is lossless — the plan you pick must be at
					least that large.
				</span>
			</div>
			<div class="tiers">
				<div class="periodtabs" role="radiogroup" aria-label="Billing period">
					<button
						type="button"
						role="radio"
						aria-checked={!monthly}
						class="periodtab"
						class:cur={!monthly}
						onclick={() => (period = 'year')}
					>
						Annual
					</button>
					<button
						type="button"
						role="radio"
						aria-checked={monthly}
						class="periodtab"
						class:cur={monthly}
						onclick={() => (period = 'month')}
					>
						Monthly
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
								>/ {period}</span
							></span
						>
						<span class="tc-rows">
							{#each p.rows as [k, v] (k)}
								<span class="trow"><span class="tk">{k}</span><span class="tv mono">{v}</span></span>
							{/each}
						</span>
						{#if lk}
							<span class="lc-lock-note">
								<Lock size={14} />Your mailbox is {stored} GB — this plan holds {p.gb} GB.
							</span>
						{/if}
					</button>
				{/each}
			</div>
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label="Back" onclick={() => goto(`/u/${slot}/mail/inbox`)}>
						<ArrowLeft />
					</Button>
					<Button variant="primary" size="lg" onclick={() => (step = 1)}>
						Continue — {sel.name} · {eur(selPrice)}/{period}<ArrowRight />
					</Button>
				</div>
			</div>
			<p class="legal">
				Restoring reactivates your existing mailbox. Nothing is re-imported; nothing to reconfigure.
			</p>
		</div>
	</div>
{:else if step === 1}
	{@const SelIcon = PLAN_ICONS[sel.icon]}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">Restore your account</p>
				<h1>Confirm &amp; restore</h1>
			</div>
			<div class="osum">
				<span class="os-ic"><SelIcon size={17} /></span>
				<span class="os-text">
					<span class="os-name">{sel.name} plan</span>
					<span class="os-sub"
						>Billed {monthly ? 'monthly' : 'yearly'} · restores {stored} GB</span
					>
				</span>
				<span class="os-right">
					<span class="os-price mono">{eur(selPrice)} / {period}</span>
					<button class="os-change" onclick={() => (step = 0)}>Change</button>
				</span>
			</div>
			<div class="osum" style="margin-bottom:18px">
				<span class="os-ic"><CreditCard size={17} /></span>
				<span class="os-text">
					<span class="os-name">Secure checkout</span>
					<span class="os-sub">Payment is handled by Stripe. Your card never touches Thelemail.</span>
				</span>
			</div>
			{#if notice}
				<p class="lc-restore-notice"><CircleAlert size={15} />{notice}</p>
			{/if}
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label="Back" onclick={() => (step = 0)} disabled={busy}>
						<ArrowLeft />
					</Button>
					<Button variant="primary" size="lg" disabled={busy} onclick={pay}>
						{#if busy}<span class="spinner"></span>Restoring…{:else}<RotateCcw />Pay {eur(selPrice)} &amp;
							restore{/if}
					</Button>
				</div>
			</div>
			<p class="cardnote">
				<Zap size={14} />Restore is instant — usually under a minute. Your account was never
				dismantled.
			</p>
		</div>
	</div>
{:else}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="welcome">
				<img class="brandmark brandmark-lg" src={mark} alt="Thelemail" />
				<h1>Welcome back.</h1>
				<p>Your mailbox is active again. Everything is exactly where you left it.</p>
			</div>
			<ul class="lc-welcome-truths">
				{#if ctx.cameFromSuspended}
					<li>
						<CornerUpLeft size={16} />
						<span
							>Mail sent between <b>{fmt.med(ctx.dates.suspend)}</b> and today was
							<b>returned to senders</b> — they saw a note that the mailbox was unavailable.</span
						>
					</li>
				{:else}
					<li>
						<Inbox size={16} />
						<span
							><b>34 messages arrived while you were read-only</b> — they're waiting in your inbox.</span
						>
					</li>
				{/if}
				<li>
					<Clock size={16} />
					<span
						>Your <b>scheduled sends are in Drafts</b>; auto-forwarding and auto-replies are
						<b>off</b> until you re-enable them.</span
					>
				</li>
				<li>
					<BellRing size={16} />
					<span
						>Some newsletters may have <b>unsubscribed you</b> after seeing bounces — worth a quick
						check.</span
					>
				</li>
			</ul>
			<div class="actions" style="margin-top:22px">
				<Button variant="primary" size="lg" block onclick={enterMailbox}>
					<Mail />Enter your mailbox
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
