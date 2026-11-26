<script lang="ts">
	import type { Snippet } from 'svelte';
	import StepPills from '$core/auth/form/StepPills.svelte';
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
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowLeft,
		faArrowRight,
		faBriefcase,
		faMinus,
		faPlus,
		faShieldCheck,
		faUser,
		faUserGroup
	} from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import { OptionTiles } from '$core/components/ui/option-tiles';
	import { Segmented } from '$core/components/ui/segmented';
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

	const headingText = $derived(heading ?? m.auth_plan_heading());
	const ctaText = $derived(ctaVerb ?? m.auth_plan_cta_continue_payment());
	const busyText = $derived(busyLabel ?? m.auth_preparing_checkout());

	const ICONS = { personal: faUser, family: faUserGroup, business: faBriefcase };

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

<div class="card-surface wide">
	{#if showStepper}
		<StepPills total={labels.length} current={2} />
	{/if}
	<div class="card-head">
		{#if eyebrow}
			<p class="eyebrow">{eyebrow}</p>
		{/if}
		<h1>{headingText}</h1>
		<p>{product.tagline}</p>
	</div>

	<OptionTiles
		class="prodtabs"
		columns={3}
		aria-label={m.auth_plan_product_group()}
		value={product.id}
		onValueChange={(v) => pickProduct(v as ProductId)}
		options={PRODUCTS.map((p) => ({ value: p.id, title: p.name, icon: ICONS[p.id], badge: p.badge }))}
	>
		{#snippet tile(option)}
			{@const p = PRODUCTS.find((x) => x.id === option.value)!}
			<span class="pt-from mono">
				{p.perMailbox
					? m.auth_plan_from_per_mailbox({ price: eur(perMonth(p.tiers[0])) })
					: m.auth_plan_from({ price: eur(perMonth(p.tiers[0])) })}
			</span>
		{/snippet}
	</OptionTiles>

	<Segmented
		value={sel.period}
		options={[
			{ value: 'year', label: m.auth_plan_period_annual() },
			{ value: 'month', label: m.auth_plan_period_monthly() }
		]}
		onValueChange={pickPeriod}
		aria-label={m.auth_plan_period_group()}
		class="periodseg"
	/>

	{#if product.perMailbox}
		<div class="seats">
			<span class="seats-lab">{m.auth_plan_seats_label()}</span>
			<span class="seats-ctl">
				<Button
					variant="neutral"
					size="icon-sm"
					aria-label={m.auth_plan_seats_fewer()}
					disabled={sel.seats <= MIN_SEATS}
					onclick={() => setSeats(sel.seats - 1)}
				>
					<Icon icon={faMinus} size={15} />
				</Button>
				<span class="seats-n mono">{sel.seats}</span>
				<Button
					variant="neutral"
					size="icon-sm"
					aria-label={m.auth_plan_seats_more()}
					disabled={sel.seats >= MAX_SEATS}
					onclick={() => setSeats(sel.seats + 1)}
				>
					<Icon icon={faPlus} size={15} />
				</Button>
			</span>
			<span class="seats-note">{m.auth_plan_seats_note({ min: MIN_SEATS })}</span>
		</div>
	{/if}

	<OptionTiles
		class="tiers"
		columns={2}
		aria-label={m.auth_plan_tier_group()}
		value={sel.tier ?? undefined}
		onValueChange={pickTier}
		options={product.tiers.map((t) => ({ value: t.id, title: t.name, badge: t.badge }))}
	>
		{#snippet tile(option, selected)}
			{@const t = product.tiers.find((x) => x.id === option.value)!}
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
				<span class="tc-total mono" class:on={selected}>
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
		{/snippet}
	</OptionTiles>

	<p class="bothline">
		<Icon icon={faShieldCheck} size={15} />
		<span>{product.bothLine}</span>
	</p>

	<div class="actions">
		<div class="btnrow">
			{#if onBack}
				<Button variant="neutral" size="icon-lg" aria-label={m.common_back()} onclick={onBack}>
					<Icon icon={faArrowLeft} size={17} />
				</Button>
			{/if}
			<Button variant="primary" size="lg" disabled={!tier} {busy} busyLabel={busyText} onclick={onNext}>
				{#if tier}
					{m.auth_plan_cta({
						verb: ctaText,
						plan: tier.name,
						price: pricePerPeriod(total, sel.period)
					})}
					<Icon icon={faArrowRight} size={17} />
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
