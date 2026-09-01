<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { platform } from '$platform';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Users from '@lucide/svelte/icons/users';
	import Building2 from '@lucide/svelte/icons/building-2';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import CardHead from '../CardHead.svelte';
	import Badge from '../Badge.svelte';
	import MembershipCard from '../MembershipCard.svelte';
	import type { CeremonyKind } from '../data';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { billing } from '$lib/stores/billing.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { createBillingPortalSession } from '$lib/api/billing';
	import { PRODUCTS, FREE_PLAN, eur } from '$lib/auth/plans';
	import { planLabel, freeNote } from '../plan-display';
	import UpgradeNudge from '../UpgradeNudge.svelte';

	interface Props {
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

	let portalBusy = $state(false);
	let portalError = $state<string | null>(null);

	const ws = $derived(workspaces.workspace);
	const type = $derived(ws?.type ?? null);
	const sub = $derived(billing.subscription);
	const isPersonal = $derived(type === 'personal');
	const isFree = $derived(billing.isFree);
	const isOwner = $derived(workspaces.isOwner(auth.accountId));
	const PlanIcon = $derived(
		type === 'business' ? Building2 : type === 'family' ? Users : UserRound
	);

	$effect(() => {
		void billing.refresh();
	});

	const tierInfo = $derived.by(() => {
		const code = sub?.planCode;
		if (!code) return null;
		const tierId = code.replace(/_/g, '-');
		for (const product of PRODUCTS) {
			const tier = product.tiers.find((t) => t.id === tierId);
			if (tier) return { product, tier };
		}
		return null;
	});

	const planName = $derived(isFree ? FREE_PLAN.name : (tierInfo?.tier.name ?? planLabel(type)));

	const priceLine = $derived.by(() => {
		if (!tierInfo || !sub) return null;
		if (tierInfo.product.perMailbox) {
			const seats = sub.seats ?? 1;
			return `${eur(tierInfo.tier.price)} × ${seats} mailbox${seats === 1 ? '' : 'es'} = ${eur(tierInfo.tier.price * seats)} / year`;
		}
		return `${eur(tierInfo.tier.price)} / year`;
	});

	const renewalLine = $derived.by(() => {
		if (!sub?.currentPeriodEnd) return null;
		const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(
			new Date(sub.currentPeriodEnd)
		);
		return sub.cancelAtPeriodEnd ? `Ends ${date}` : `Renews ${date}`;
	});

	async function openPortal() {
		if (portalBusy) return;
		portalBusy = true;
		portalError = null;
		try {
			const origin = platform.returnOrigin();
			const slot = page.params.slot;
			const { url } = await createBillingPortalSession({
				returnUrl: `${origin}/u/${slot}/settings/account`
			});
			platform.openExternal(url);
		} catch (err) {
			portalBusy = false;
			portalError = err instanceof Error ? err.message : 'Could not open billing portal';
		}
	}

	function choosePlan() {
		void goto(`/u/${page.params.slot}/billing/choose`);
	}
</script>

<SecHead
	title="Account & plan"
	desc="Your subscription, the people on it, and your right to take everything and leave."
/>

{#if !ws}
	<div class="scard">
		<div class="plan-top">
			<div class="plan-id">
				<div class="plan-eyebrow">Loading your plan…</div>
			</div>
		</div>
	</div>
{:else}
	<div class="scard plan-card" data-type={type}>
		<div class="plan-top">
			<div class="plan-id">
				<div class="plan-eyebrow">Current plan</div>
				<div class="plan-name">
					<PlanIcon size={18} />
					<span>{planName}</span>
					{#if sub?.status === 'past_due'}
						<Badge kind="warn">Payment problem</Badge>
					{/if}
				</div>
				<div class="plan-price">
					{#if isFree}
						{freeNote()}
					{:else if priceLine}
						{priceLine}{#if renewalLine}&nbsp;&middot; {renewalLine}{/if}
					{:else if isPersonal}
						A single mailbox just for you.
					{:else if type === 'family'}
						A household sharing one plan.
					{:else}
						Members and seats with admin controls.
					{/if}
				</div>
				{#if sub?.status === 'past_due'}
					<div class="plan-warn">
						The last payment didn&rsquo;t go through. Update your payment method in the billing
						portal to keep your mailbox active.
					</div>
				{/if}
			</div>
			<div class="plan-acts">
				{#if isOwner}
					{#if isFree}
						<button type="button" class="btn btn-primary btn-sm" onclick={choosePlan}>
							Upgrade
						</button>
					{:else if sub && (sub.status === 'active' || sub.status === 'past_due')}
						{#if sub.status === 'active'}
							<button type="button" class="btn btn-ghost btn-sm" onclick={choosePlan}>
								Change plan
							</button>
						{/if}
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							disabled={portalBusy}
							onclick={openPortal}
						>
							<ExternalLink size={14} />
							{portalBusy ? 'Opening…' : 'Manage billing'}
						</button>
					{:else}
						<button type="button" class="btn btn-primary btn-sm" onclick={choosePlan}>
							Choose a plan
						</button>
					{/if}
				{/if}
			</div>
		</div>
		{#if portalError}
			<div class="plan-warn">{portalError}</div>
		{/if}
	</div>

	{#if isFree}
		<div class="upgrade-list">
			<UpgradeNudge
				title="Add people with a Family or Team plan"
				desc="Households and teams share one plan, one domain, and admin controls for every mailbox."
			/>
		</div>
	{:else if !isPersonal}
		<MembershipCard {launch} />
	{/if}
{/if}

<div class="scard danger">
	<CardHead icon={CircleAlert} title="Delete account" />
	<Row
		t="Delete this account permanently"
		d="Deactivates the account now and erases every mailbox, address, and message after a 30-day grace period. Once purged, encrypted data is gone for good. Export first."
	>
		<button type="button" class="btn btn-danger btn-sm" onclick={() => launch('delete')}>
			<Trash2 size={14} />Delete account…
		</button>
	</Row>
</div>

<style>
	.plan-name {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.plan-warn {
		margin-top: 8px;
		font-size: var(--text-sm, 13px);
		color: var(--warning-500, #c08431);
	}
</style>
