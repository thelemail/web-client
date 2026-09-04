<script lang="ts">
	import type { Snippet } from 'svelte';
	import Stepper from '$lib/auth/Stepper.svelte';
	import {
		PRODUCTS,
		MIN_SEATS,
		MAX_SEATS,
		findPlan,
		planTotal,
		annualSavingPercent,
		eur,
		type BillingPeriod,
		type PlanSelection,
		type PlanTier,
		type ProductId
	} from '$lib/auth/plans';
	import UserRound from '@lucide/svelte/icons/user-round';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import BriefcaseBusiness from '@lucide/svelte/icons/briefcase-business';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { Button } from '$lib/components/ui/button';

	let {
		sel = $bindable(),
		labels = [],
		onBack = null,
		onNext,
		showStepper = true,
		eyebrow = 'Step 3 of 4',
		heading = 'Choose your plan',
		ctaVerb = 'Continue to payment',
		busy = false,
		busyLabel = 'Preparing secure checkout…',
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
		if (monthly) return 'Billed monthly, cancel any time';
		return product.perMailbox
			? `${eur(t.prices.year)} a mailbox, billed once a year`
			: `${eur(t.prices.year)} billed once a year`;
	}
	function savingNote(t: PlanTier): string {
		return product.perMailbox
			? `Annual is ${eur(t.prices.year)} a mailbox each year and saves ${annualSavingPercent(t)}%.`
			: `Annual is ${eur(t.prices.year)} a year and saves ${annualSavingPercent(t)}%.`;
	}
</script>

<div class="card-surface screen-fade wide">
	{#if showStepper}
		<Stepper step={2} {labels} />
	{/if}
	<div class="card-head">
		{#if eyebrow}
			<p class="eyebrow">{eyebrow}</p>
		{/if}
		<h1>{heading}</h1>
		<p>{product.tagline}</p>
	</div>

	<div class="prodtabs" role="radiogroup" aria-label="Product">
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
						? `from ${eur(perMonth(p.tiers[0]))} / mailbox · month`
						: `from ${eur(perMonth(p.tiers[0]))} / month`}
				</span>
			</button>
		{/each}
	</div>

	<div class="periodtabs" role="radiogroup" aria-label="Billing period">
		<button
			type="button"
			role="radio"
			aria-checked={!monthly}
			class="periodtab"
			class:cur={!monthly}
			onclick={() => pickPeriod('year')}
		>
			Annual
		</button>
		<button
			type="button"
			role="radio"
			aria-checked={monthly}
			class="periodtab"
			class:cur={monthly}
			onclick={() => pickPeriod('month')}
		>
			Monthly
		</button>
	</div>

	{#if product.perMailbox}
		<div class="seats">
			<span class="seats-lab">Mailboxes</span>
			<span class="seats-ctl">
				<button
					type="button"
					class="seatbtn"
					aria-label="Fewer mailboxes"
					disabled={sel.seats <= MIN_SEATS}
					onclick={() => setSeats(sel.seats - 1)}
				>
					<Minus size={15} strokeWidth={1.75} />
				</button>
				<span class="seats-n mono">{sel.seats}</span>
				<button
					type="button"
					class="seatbtn"
					aria-label="More mailboxes"
					disabled={sel.seats >= MAX_SEATS}
					onclick={() => setSeats(sel.seats + 1)}
				>
					<Plus size={15} strokeWidth={1.75} />
				</button>
			</span>
			<span class="seats-note">Starts at 3 — prorated when your team changes mid-term.</span>
		</div>
	{/if}

	<div class="tiers" role="radiogroup" aria-label="Plan">
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
					<span class="tc-per mono">{product.perMailbox ? '/ mailbox · month' : '/ month'}</span>
				</span>
				<span class="tc-charge mono">{chargeNote(t)}</span>
				{#if monthly}
					<span class="tc-saving mono">{savingNote(t)}</span>
				{/if}
				{#if product.perMailbox}
					<span class="tc-total mono" class:on={seld}>
						{sel.seats} mailboxes = {eur(t.prices[sel.period] * sel.seats)} / {sel.period}
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
				<Button variant="secondary" size="lg" class="btn-back" aria-label="Back" onclick={onBack}>
					<ArrowLeft size={17} strokeWidth={1.75} />
				</Button>
			{/if}
			<Button variant="primary" size="lg" disabled={!tier || busy} onclick={onNext}>
				{#if busy}
					<span class="spinner"></span>{busyLabel}
				{:else if tier}
					{ctaVerb} — {tier.name} · {eur(total)} / {sel.period}
					<ArrowRight size={17} strokeWidth={1.75} />
				{:else}
					Select a plan to continue
				{/if}
			</Button>
		</div>
	</div>
	<p class="legal">
		{monthly ? 'Monthly billing' : 'Annual billing'}. Prices include VAT where applicable. Cancel
		anytime &mdash; your archive stays exportable.
	</p>
	{#if footer}
		{@render footer()}
	{/if}
</div>
