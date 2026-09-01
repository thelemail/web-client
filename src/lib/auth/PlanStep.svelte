<script lang="ts">
	import type { Snippet } from 'svelte';
	import Stepper from '$lib/auth/Stepper.svelte';
	import {
		PRODUCTS,
		MIN_SEATS,
		MAX_SEATS,
		findPlan,
		planTotal,
		eur,
		type PlanSelection,
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

	function pickProduct(id: ProductId) {
		sel = { ...sel, product: id, tier: null };
	}
	function pickTier(id: string) {
		sel = { ...sel, tier: id };
	}
	function setSeats(n: number) {
		sel = { ...sel, seats: Math.min(MAX_SEATS, Math.max(MIN_SEATS, n)) };
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
						? `from ${eur(p.tiers[0].price)} / mailbox · year`
						: `from ${eur(p.tiers[0].price)} / year`}
				</span>
			</button>
		{/each}
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
			<span class="seats-note">Starts at 3 — prorated when your team changes mid-year.</span>
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
					<b class="serif">{eur(t.price)}</b>
					<span class="tc-per mono">{product.perMailbox ? '/ mailbox · year' : '/ year'}</span>
				</span>
				{#if product.perMailbox}
					<span class="tc-total mono" class:on={seld}>
						{sel.seats} mailboxes = {eur(t.price * sel.seats)} / year
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
				<button class="btn btn-secondary btn-back" aria-label="Back" onclick={onBack}>
					<ArrowLeft size={17} strokeWidth={1.75} />
				</button>
			{/if}
			<button class="btn btn-primary" disabled={!tier || busy} onclick={onNext}>
				{#if busy}
					<span class="spinner"></span>{busyLabel}
				{:else if tier}
					{ctaVerb} — {tier.name} · {eur(total)} / year
					<ArrowRight size={17} strokeWidth={1.75} />
				{:else}
					Select a plan to continue
				{/if}
			</button>
		</div>
	</div>
	<p class="legal">
		Yearly billing. Prices include VAT where applicable. Cancel anytime &mdash; your archive stays
		exportable.
	</p>
	{#if footer}
		{@render footer()}
	{/if}
</div>
