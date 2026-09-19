<script lang="ts">
	import type { Snippet } from 'svelte';
	import Stepper from '$core/auth/Stepper.svelte';
	import {
		PRODUCTS,
		MIN_SEATS,
		MAX_SEATS,
		findPlan,
		planTotal,
		annualSavingPercent,
		eur,
		pricePerPeriod,
		type BillingPeriod,
		type PlanSelection,
		type PlanTier,
		type ProductId
	} from '$core/auth/plans';
	import UserRound from '@lucide/svelte/icons/user-round';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import BriefcaseBusiness from '@lucide/svelte/icons/briefcase-business';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

	let {
		sel = $bindable(),
		labels = [],
		onBack = null,
		onNext,
		showStepper = true,
		eyebrow,
		heading,
		ctaVerb,
		busy = false,
		busyLabel,
		footer = null
	}: {
		sel: PlanSelection;
		labels?: string[];
		onBack?: (() => void) | null;
		onNext: () => void;
		showStepper?: boolean;
		eyebrow?: string;
		heading?: string;
		ctaVerb?: string;
		busy?: boolean;
		busyLabel?: string;
		footer?: Snippet | null;
	} = $props();

	const eyebrowText = $derived(eyebrow ?? m.auth_step_of({ step: 3, total: 4 }));
	const headingText = $derived(heading ?? m.auth_plan_heading());
	const ctaText = $derived(ctaVerb ?? m.auth_plan_cta_continue_payment());
	const busyText = $derived(busyLabel ?? m.auth_preparing_checkout());

	const ICONS = { personal: UserRound, family: UsersRound, business: BriefcaseBusiness };

	const product = $derived(findPlan(sel).product);
	const tier = $derived(findPlan(sel).tier);
	const total = $derived(planTotal(sel));
	const monthly = $derived(sel.period === 'month');

	function pickProduct(id: ProductId) {
		sel = { ...sel, product: id, tier: null };
	}
	function pickTier(id: string) {
		sel = { ...sel, tier: id };
	}
	function setSeats(n: number) {
		sel = { ...sel, seats: Math.min(MAX_SEATS, Math.max(MIN_SEATS, n)) };
	}
	function pickPeriod(period: BillingPeriod) {
		sel = { ...sel, period };
	}

	function perMonth(t: PlanTier): number {
		return monthly ? t.prices.month : t.prices.year / 12;
	}
	function chargeNote(t: PlanTier): string {
		if (monthly) return m.auth_plan_charge_monthly();
		return product.perMailbox
			? m.auth_plan_charge_yearly_per_mailbox({ price: eur(t.prices.year) })
			: m.auth_plan_charge_yearly({ price: eur(t.prices.year) });
	}
	function savingNote(t: PlanTier): string {
		return product.perMailbox
			? m.auth_plan_saving_per_mailbox({
					price: eur(t.prices.year),
					percent: annualSavingPercent(t)
				})
			: m.auth_plan_saving({ price: eur(t.prices.year), percent: annualSavingPercent(t) });
	}
</script>

<div class="card-surface screen-fade wide">
	{#if showStepper}
		<Stepper step={2} {labels} />
	{/if}
	<div class="card-head">
		{#if eyebrowText}
			<p class="eyebrow">{eyebrowText}</p>
		{/if}
		<h1>{headingText}</h1>
		<p>{product.tagline}</p>
	</div>

	<div class="prodtabs" role="radiogroup" aria-label={m.auth_plan_product_group()}>
		{#each PRODUCTS as p (p.id)}
			{@const ProductIcon = ICONS[p.id]}
			<button
				type="button"
				role="radio"
				aria-checked={p.id === product.id}
				class="prodtab"
				class:cur={p.id === product.id}
				onclick={() => pickProduct(p.id)}
			>
				{#if p.badge}
					<span class="mostbadge">{p.badge}</span>
				{/if}
				<span class="pt-top">
					<ProductIcon size={16} strokeWidth={1.75} />
					<span class="pt-name">{p.name}</span>
				</span>
				<span class="pt-from mono">
					{p.perMailbox
						? m.auth_plan_from_per_mailbox({ price: eur(perMonth(p.tiers[0])) })
						: m.auth_plan_from({ price: eur(perMonth(p.tiers[0])) })}
				</span>
			</button>
		{/each}
	</div>

	<div class="periodtabs" role="radiogroup" aria-label={m.auth_plan_period_group()}>
		<button
			type="button"
			role="radio"
			aria-checked={!monthly}
			class="periodtab"
			class:cur={!monthly}
			onclick={() => pickPeriod('year')}
		>
			{m.auth_plan_period_annual()}
		</button>
		<button
			type="button"
			role="radio"
			aria-checked={monthly}
			class="periodtab"
			class:cur={monthly}
			onclick={() => pickPeriod('month')}
		>
			{m.auth_plan_period_monthly()}
		</button>
	</div>

	{#if product.perMailbox}
		<div class="seats">
			<span class="seats-lab">{m.auth_plan_seats_label()}</span>
			<span class="seats-ctl">
				<button
					type="button"
					class="seatbtn"
					aria-label={m.auth_plan_seats_fewer()}
					disabled={sel.seats <= MIN_SEATS}
					onclick={() => setSeats(sel.seats - 1)}
				>
					<Minus size={15} strokeWidth={1.75} />
				</button>
				<span class="seats-n mono">{sel.seats}</span>
				<button
					type="button"
					class="seatbtn"
					aria-label={m.auth_plan_seats_more()}
					disabled={sel.seats >= MAX_SEATS}
					onclick={() => setSeats(sel.seats + 1)}
				>
					<Plus size={15} strokeWidth={1.75} />
				</button>
			</span>
			<span class="seats-note">{m.auth_plan_seats_note({ min: MIN_SEATS })}</span>
		</div>
	{/if}

	<div class="tiers" role="radiogroup" aria-label={m.auth_plan_tier_group()}>
		{#each product.tiers as t (t.id)}
			{@const seld = t.id === sel.tier}
			<button
				type="button"
				role="radio"
				aria-checked={seld}
				class="tiercard"
				class:sel={seld}
				onclick={() => pickTier(t.id)}
			>
				{#if t.badge}
					<span class="mostbadge">{t.badge}</span>
				{/if}
				<span class="tc-pick" aria-hidden="true"><Check size={13} strokeWidth={2.5} /></span>
				<span class="tc-name">{t.name}</span>
				{#if t.framing}
					<span class="tc-framing serif">{t.framing}</span>
				{:else}
					<span class="tc-framing serif">&nbsp;</span>
				{/if}
				<span class="tc-price">
					<b class="serif">{eur(perMonth(t))}</b>
					<span class="tc-per mono">{product.perMailbox ? m.auth_plan_per_mailbox_month() : m.auth_plan_per_month()}</span>
				</span>
				<span class="tc-charge mono">{chargeNote(t)}</span>
				{#if monthly}
					<span class="tc-saving mono">{savingNote(t)}</span>
				{/if}
				{#if product.perMailbox}
					<span class="tc-total mono" class:on={seld}>
						{m.auth_plan_seats_total({
							count: sel.seats,
							total: pricePerPeriod(t.prices[sel.period] * sel.seats, sel.period)
						})}
					</span>
				{/if}
				<span class="tc-rows">
					{#each t.rows as [k, v] (k)}
						<span class="trow"><span class="tk">{k}</span><span class="tv mono">{v}</span></span>
					{/each}
				</span>
			</button>
		{/each}
	</div>

	<p class="bothline">
		<ShieldCheck size={15} strokeWidth={1.75} />
		<span>{product.bothLine}</span>
	</p>

	<div class="actions">
		<div class="btnrow">
			{#if onBack}
				<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} onclick={onBack}>
					<ArrowLeft size={17} strokeWidth={1.75} />
				</Button>
			{/if}
			<Button variant="primary" size="lg" disabled={!tier || busy} onclick={onNext}>
				{#if busy}
					<span class="spinner"></span>{busyText}
				{:else if tier}
					{m.auth_plan_cta({
						verb: ctaText,
						plan: tier.name,
						price: pricePerPeriod(total, sel.period)
					})}
					<ArrowRight size={17} strokeWidth={1.75} />
				{:else}
					{m.auth_plan_select_to_continue()}
				{/if}
			</Button>
		</div>
	</div>
	<p class="legal">
		{monthly ? m.auth_plan_legal_monthly() : m.auth_plan_legal_annual()}
	</p>
	{#if footer}
		{@render footer()}
	{/if}
</div>
