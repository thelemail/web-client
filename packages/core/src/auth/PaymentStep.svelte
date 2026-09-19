<script lang="ts">
	import Stepper from '$core/auth/Stepper.svelte';
	import { findPlan, planTotal, eur, pricePerPeriod, type PlanSelection } from '$core/auth/plans';
	import UserRound from '@lucide/svelte/icons/user-round';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import BriefcaseBusiness from '@lucide/svelte/icons/briefcase-business';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Landmark from '@lucide/svelte/icons/landmark';
	import Lock from '@lucide/svelte/icons/lock';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	let {
		handle,
		sel,
		labels,
		submitting,
		error,
		onBack,
		onChangePlan,
		onPay
	}: {
		handle: string;
		sel: PlanSelection;
		labels: string[];
		submitting: boolean;
		error: string | null;
		onBack: () => void;
		onChangePlan: () => void;
		onPay: () => void;
	} = $props();

	const ICONS = { personal: UserRound, family: UsersRound, business: BriefcaseBusiness };

	const product = $derived(findPlan(sel).product);
	const tier = $derived(findPlan(sel).tier);
	const total = $derived(planTotal(sel));
	const ProductIcon = $derived(ICONS[product.id]);

	let accepted = $state(false);

	function pay() {
		if (submitting || !accepted) return;
		onPay();
	}
</script>

{#snippet addr(t: string)}<span class="mono" style="color:var(--ink-700)">{t}</span>{/snippet}
{#snippet terms(t: string)}<a href="https://thelemail.com/terms" target="_blank" rel="noopener">{t}</a>{/snippet}
{#snippet privacy(t: string)}<a href="https://thelemail.com/privacy" target="_blank" rel="noopener">{t}</a>{/snippet}

<div class="card-surface screen-fade">
	<Stepper step={3} {labels} compact />
	<div class="card-head">
		<p class="eyebrow">{m.auth_step_of({ step: 4, total: 4 })}</p>
		<h1>{m.auth_payment_heading()}</h1>
		<p><Rich text={m.auth_payment_for({ address: `${handle}@thelemail.com` })} tags={{ addr }} /></p>
	</div>

	<div class="osum">
		<span class="os-ic"><ProductIcon size={17} strokeWidth={1.75} /></span>
		<span class="os-text">
			<span class="os-name">{m.auth_payment_plan_name({ plan: tier ? tier.name : product.name })}</span>
			<span class="os-sub">
				{product.perMailbox
					? sel.period === 'month'
						? m.auth_payment_seats_monthly({ count: sel.seats })
						: m.auth_payment_seats_yearly({ count: sel.seats })
					: sel.period === 'month'
						? m.auth_payment_billed_monthly()
						: m.auth_payment_billed_yearly()}
			</span>
		</span>
		<span class="os-right">
			<span class="os-price mono">{pricePerPeriod(total, sel.period)}</span>
			<button type="button" class="os-change" onclick={onChangePlan}>{m.auth_payment_change()}</button>
		</span>
	</div>

	<div class="form">
		<div class="handoff">
			<p class="handoff-lead">
				<ShieldCheck size={15} strokeWidth={1.75} />
				<span>{m.auth_payment_handoff()}</span>
			</p>
			<div class="handoff-methods">
				<span class="handoff-method"><CreditCard size={15} strokeWidth={1.75} />{m.auth_payment_method_card()}</span>
				<span class="handoff-method"><Landmark size={15} strokeWidth={1.75} />{m.auth_payment_method_sepa()}</span>
			</div>
		</div>

		{#if error}
			<span class="errtext">
				<CircleAlert size={13} strokeWidth={1.75} />
				<span>{error}</span>
			</span>
		{/if}

		<label class="accept">
			<input type="checkbox" bind:checked={accepted} required />
			<span><Rich text={m.auth_payment_accept_terms()} tags={{ terms, privacy }} /></span>
		</label>

		<div class="actions">
			<div class="btnrow">
				<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} disabled={submitting} onclick={onBack}>
					<ArrowLeft size={17} strokeWidth={1.75} />
				</Button>
				<Button variant="primary" size="lg" disabled={submitting || !accepted} onclick={pay}>
					{#if submitting}
						<span class="spinner"></span>{m.auth_preparing_checkout()}
					{:else}
						<Lock size={17} strokeWidth={1.75} />{m.auth_payment_pay({ price: eur(total) })}
					{/if}
				</Button>
			</div>
		</div>
	</div>
	<p class="cardnote">
		<Lock size={14} strokeWidth={1.75} />{m.auth_payment_card_note()}
	</p>
	<p class="legal">
		{sel.period === 'month' ? m.auth_payment_renews_monthly() : m.auth_payment_renews_yearly()}
	</p>
</div>

<style>
	.handoff {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		border: 1px solid var(--line-strong, rgba(0, 0, 0, 0.12));
		border-radius: var(--radius-md, 8px);
		background: var(--paper-50, #f7f3e9);
	}
	.handoff-lead {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		margin: 0;
		font-size: var(--text-sm, 13px);
		color: var(--ink-700, #3a4032);
		line-height: 1.5;
	}
	.handoff-lead :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--pine-700, #234132);
	}
	.handoff-methods {
		display: flex;
		gap: 8px;
	}
	.handoff-method {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border: 1px solid var(--line, rgba(0, 0, 0, 0.08));
		border-radius: var(--radius-pill, 999px);
		background: var(--paper-0, #fcfaf4);
		font-size: var(--text-xs, 12px);
		color: var(--ink-500, #6b7360);
	}
</style>
