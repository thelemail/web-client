<script lang="ts">
	import Stepper from '$lib/auth/Stepper.svelte';
	import { findPlan, planTotal, eur, type PlanSelection } from '$lib/auth/plans';
	import UserRound from '@lucide/svelte/icons/user-round';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import BriefcaseBusiness from '@lucide/svelte/icons/briefcase-business';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Landmark from '@lucide/svelte/icons/landmark';
	import Lock from '@lucide/svelte/icons/lock';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';

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

<div class="card-surface screen-fade">
	<Stepper step={3} {labels} compact />
	<div class="card-head">
		<p class="eyebrow">Step 4 of 4</p>
		<h1>Set up billing</h1>
		<p>For <span class="mono" style="color:var(--ink-700)">{handle}@thelemail.com</span></p>
	</div>

	<div class="osum">
		<span class="os-ic"><ProductIcon size={17} strokeWidth={1.75} /></span>
		<span class="os-text">
			<span class="os-name">{tier ? tier.name : product.name} plan</span>
			<span class="os-sub">
				{product.perMailbox
							? `${sel.seats} mailboxes · billed ${sel.period === 'month' ? 'monthly' : 'yearly'}`
							: sel.period === 'month'
								? 'Billed monthly'
								: 'Billed yearly'}
			</span>
		</span>
		<span class="os-right">
			<span class="os-price mono">{eur(total)} / {sel.period}</span>
			<button type="button" class="os-change" onclick={onChangePlan}>Change</button>
		</span>
	</div>

	<div class="form">
		<div class="handoff">
			<p class="handoff-lead">
				<ShieldCheck size={15} strokeWidth={1.75} />
				<span>
					You&rsquo;ll finish payment on our PCI-DSS certified processor&rsquo;s secure checkout.
					Thelemail never sees or stores your card number.
				</span>
			</p>
			<div class="handoff-methods">
				<span class="handoff-method"><CreditCard size={15} strokeWidth={1.75} />Card</span>
				<span class="handoff-method"><Landmark size={15} strokeWidth={1.75} />SEPA debit</span>
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
			<span>
				I agree to the
				<a href="https://thelemail.com/terms" target="_blank" rel="noopener">Terms of Service</a>
				and
				<a href="https://thelemail.com/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
			</span>
		</label>

		<div class="actions">
			<div class="btnrow">
				<button
					class="btn btn-secondary btn-back"
					aria-label="Back"
					disabled={submitting}
					onclick={onBack}
				>
					<ArrowLeft size={17} strokeWidth={1.75} />
				</button>
				<button class="btn btn-primary" disabled={submitting || !accepted} onclick={pay}>
					{#if submitting}
						<span class="spinner"></span>Preparing secure checkout&hellip;
					{:else}
						<Lock size={17} strokeWidth={1.75} />Pay {eur(total)} &mdash; secure checkout
					{/if}
				</button>
			</div>
		</div>
	</div>
	<p class="cardnote">
		<Lock size={14} strokeWidth={1.75} />Your account is created first, then you&rsquo;re taken to
		checkout. Nothing is charged until you confirm there.
	</p>
	<p class="legal">Renews {sel.period === 'month' ? 'monthly' : 'yearly'}; cancel anytime.</p>
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
