<script lang="ts">
	import StepPills from '$core/auth/form/StepPills.svelte';
	import { findPlan, planTotal, eur, pricePerPeriod, type PlanSelection } from '$core/auth/plans';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowLeft,
		faBriefcase,
		faCircleExclamation,
		faCreditCard,
		faLandmark,
		faLock,
		faShieldCheck,
		faUser,
		faUserGroup
	} from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	let {
		address,
		sel,
		labels,
		submitting,
		error,
		onBack,
		onChangePlan,
		onPay
	}: {
		address: string;
		sel: PlanSelection;
		labels: string[];
		submitting: boolean;
		error: string | null;
		onBack: () => void;
		onChangePlan: () => void;
		onPay: () => void;
	} = $props();

	const ICONS = { personal: faUser, family: faUserGroup, business: faBriefcase };

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

{#snippet addr(t: string)}<span class="mono" style="color:var(--fg)">{t}</span>{/snippet}
{#snippet terms(t: string)}<a href="https://thelemail.com/terms" target="_blank" rel="noopener">{t}</a>{/snippet}
{#snippet privacy(t: string)}<a href="https://thelemail.com/privacy" target="_blank" rel="noopener">{t}</a>{/snippet}

<div class="card-surface">
	<StepPills total={labels.length} current={3} />
	<div class="card-head">
		<h1>{m.auth_payment_heading()}</h1>
		<p><Rich text={m.auth_payment_for({ address })} tags={{ addr }} /></p>
	</div>

	<div class="osum">
		<span class="os-ic"><Icon icon={ProductIcon} size={17} /></span>
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
			<button type="button" class="os-change" disabled={submitting} onclick={onChangePlan}>{m.auth_payment_change()}</button>
		</span>
	</div>

	<div class="form">
		<div class="handoff">
			<p class="handoff-lead">
				<Icon icon={faShieldCheck} size={15} />
				<span>{m.auth_payment_handoff()}</span>
			</p>
			<div class="handoff-methods">
				<span class="handoff-method"><Icon icon={faCreditCard} size={15} />{m.auth_payment_method_card()}</span>
				<span class="handoff-method"><Icon icon={faLandmark} size={15} />{m.auth_payment_method_sepa()}</span>
			</div>
		</div>

		{#if error}
			<span class="errtext" role="alert">
				<Icon icon={faCircleExclamation} size={13} />
				<span>{error}</span>
			</span>
		{/if}

		<label class="accept">
			<input type="checkbox" bind:checked={accepted} required />
			<span><Rich text={m.auth_payment_accept_terms()} tags={{ terms, privacy }} /></span>
		</label>

		<div class="actions">
			<div class="btnrow">
				<Button variant="neutral" size="icon-lg" aria-label={m.common_back()} disabled={submitting} onclick={onBack}>
					<Icon icon={faArrowLeft} size={17} />
				</Button>
				<Button
					variant="primary"
					size="lg"
					disabled={!accepted}
					busy={submitting}
					busyLabel={m.auth_preparing_checkout()}
					onclick={pay}
				>
					<Icon icon={faLock} size={17} />{m.auth_payment_pay({ price: eur(total) })}
				</Button>
			</div>
		</div>
	</div>
	<p class="cardnote">
		<Icon icon={faLock} size={14} />{m.auth_payment_card_note()}
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
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md, 8px);
		background: var(--bg-raised);
	}
	.handoff-lead {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		margin: 0;
		font-size: var(--text-sm, 13px);
		color: var(--fg);
		line-height: 1.5;
	}
	.handoff-lead :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
		color: var(--pine-700);
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
		border: 1px solid var(--border);
		border-radius: var(--radius-pill, 999px);
		background: var(--bg);
		font-size: var(--text-xs, 12px);
		color: var(--fg-muted);
	}
</style>
