<script lang="ts">
	import { i18n } from '$core/i18n/locale.svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { platform } from '$platform';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserRound from '@lucide/svelte/icons/user-round';
	import Users from '@lucide/svelte/icons/users';
	import Building2 from '@lucide/svelte/icons/building-2';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Card from '../Card.svelte';
	import Badge from '../Badge.svelte';
	import MembershipCard from '../MembershipCard.svelte';
	import type { CeremonyKind } from '../data';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { createBillingPortalSession } from '$core/api/billing';
	import { ApiCallError } from '$core/api/types';
	import { planNameFor, subscriptionPrice } from '$core/auth/plans';
	import { planLabel, freeNote } from '../plan-display';
	import UpgradeNudge from '../UpgradeNudge.svelte';
	import { Button } from '$core/components/ui/button';
	import { entryPointVisible, scheduledLine, storeStep } from '$core/lifecycle/downgrade';
	import { m } from '$paraglide/messages.js';
	import Download from '@lucide/svelte/icons/download';
	import { EXPORT_TOOL_URL } from '../exportTool';

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
	const isFreeFamily = $derived(billing.isFreeFamily);
	const isSoloFree = $derived(billing.planCode === 'free');
	const isOwner = $derived(workspaces.isOwner(auth.accountId));
	const canMoveToFree = $derived(isOwner && entryPointVisible(sub));
	const pendingLine = $derived(scheduledLine(sub));
	const store = $derived(storeStep(sub));
	const slot = $derived(page.params.slot ?? '0');
	const PlanIcon = $derived(
		type === 'business' ? Building2 : type === 'family' ? Users : UserRound
	);

	$effect(() => {
		void billing.refresh();
		void billing.ensureCatalog();
	});

	const planName = $derived(
		isFree || !sub?.planCode ? planLabel(type, sub?.planCode) : planNameFor(sub.planCode, billing.plan)
	);

	const priceLine = $derived.by(() => {
		const price = subscriptionPrice(billing.plan, sub);
		if (!price) return null;
		if (price.perMailbox) {
			const args = { price: price.unit, count: price.seats, total: price.total };
			return price.period === 'month'
				? m.settings_account_price_seats_month(args)
				: m.settings_account_price_seats_year(args);
		}
		return price.period === 'month'
			? m.settings_account_price_month({ price: price.total })
			: m.settings_account_price_year({ price: price.total });
	});

	const renewalLine = $derived.by(() => {
		if (!sub?.currentPeriodEnd) return null;
		const date = new Intl.DateTimeFormat(i18n.tag, { dateStyle: 'long' }).format(
			new Date(sub.currentPeriodEnd)
		);
		return sub.cancelAtPeriodEnd
			? m.settings_account_ends({ date })
			: m.settings_account_renews({ date });
	});

	function portalErrorMessage(err: unknown): string {
		if (err instanceof ApiCallError) {
			if (err.status === 409) return m.settings_account_portal_store_managed();
			if (err.status === 404) return m.settings_account_portal_no_subscription();
		}
		return m.settings_account_portal_failed();
	}

	async function openPortal() {
		if (portalBusy) return;
		if (store) {
			portalError = null;
			platform.openExternal(store.url);
			return;
		}
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
			portalError = portalErrorMessage(err);
		}
	}

	function choosePlan() {
		void goto(`/u/${page.params.slot}/billing/choose`);
	}
</script>

<SecHead desc={m.settings_account_desc()} />

{#if !ws}
	<Card>
		<div class="plan-top">
			<div class="plan-id">
				<div class="plan-eyebrow">{m.settings_account_loading_plan()}</div>
			</div>
		</div>
	</Card>
{:else}
	<Card class="plan-card" data-type={type}>
		<div class="plan-top">
			<div class="plan-id">
				<div class="plan-eyebrow">{m.settings_account_current_plan()}</div>
				<div class="plan-name">
					<PlanIcon size={18} />
					<span>{planName}</span>
					{#if sub?.status === 'past_due'}
						<Badge kind="warn">{m.settings_account_payment_problem()}</Badge>
					{/if}
				</div>
				<div class="plan-price">
					{#if isFree}
						{freeNote(type, sub?.planCode, billing.plan)}
					{:else if priceLine}
						{priceLine}{#if renewalLine}&nbsp;&middot; {renewalLine}{/if}
					{:else if isPersonal}
						{m.settings_account_personal_desc()}
					{:else if type === 'family'}
						{m.settings_account_family_desc()}
					{:else}
						{m.settings_account_business_desc()}
					{/if}
				</div>
				{#if sub?.status === 'past_due'}
					<div class="plan-warn">
						{m.settings_account_past_due()}
					</div>
				{/if}
			</div>
			<div class="plan-acts">
				{#if isOwner}
					{#if isFree}
						<Button variant="primary" size="sm" onclick={choosePlan}>
							{m.settings_account_upgrade()}
						</Button>
					{:else if sub && (sub.status === 'active' || sub.status === 'past_due')}
						{#if sub.status === 'active'}
							<Button variant="ghost" size="sm" onclick={choosePlan}>
								{m.settings_account_change_plan()}
							</Button>
						{/if}
						<Button variant="ghost" size="sm" disabled={portalBusy} onclick={openPortal}>
							<ExternalLink size={14} />
							{portalBusy
								? m.settings_account_opening()
								: store
									? m.settings_account_manage_in_store({ store: store.label })
									: m.settings_account_manage_billing()}
						</Button>
						{#if canMoveToFree}
							<Button variant="ghost" size="sm" href={`/u/${slot}/lifecycle/downgrade`}>
								{m.settings_account_move_to_free()}
							</Button>
						{/if}
						{#if sub.status === 'active' && !sub.cancelAtPeriodEnd}
							<Button variant="ghost" size="sm" href={`/u/${slot}/billing/cancel`}>
								{m.settings_account_cancel_plan()}
							</Button>
						{/if}
					{:else}
						<Button variant="primary" size="sm" onclick={choosePlan}>
							{m.settings_account_choose_plan()}
						</Button>
					{/if}
				{/if}
			</div>
		</div>
		{#if portalError}
			<div class="plan-warn">{portalError}</div>
		{/if}
		{#if pendingLine}
			<div class="plan-warn">
				{pendingLine}
				<a href={`/u/${slot}/lifecycle/downgrade`}>{m.settings_account_see_changes()}</a>
			</div>
		{/if}
	</Card>

	{#if isSoloFree}
		{#if isOwner}
			<Card icon={Users} title={m.settings_account_start_family()}>
				<Row
					t={m.settings_account_start_family_row()}
					d={m.settings_account_start_family_desc()}
				>
					<Button variant="secondary" size="sm" onclick={() => launch('family')}>
						<Users size={14} />{m.settings_account_start_family()}
					</Button>
				</Row>
			</Card>
		{/if}
		<div class="upgrade-list">
			<UpgradeNudge
				title={m.settings_account_nudge_solo_title()}
				desc={m.settings_account_nudge_solo_desc()}
			/>
		</div>
	{:else if !isPersonal}
		<MembershipCard {launch} />
		{#if isFreeFamily}
			<div class="upgrade-list">
				<UpgradeNudge
					title={m.settings_account_nudge_family_title()}
					desc={m.settings_account_nudge_family_desc()}
				/>
			</div>
		{/if}
	{/if}
{/if}

<Card icon={Download} title={m.settings_account_export_title()}>
	<Row t={m.settings_account_export_row()} d={m.settings_account_export_desc()}>
		<Button variant="secondary" size="sm" href={EXPORT_TOOL_URL} target="_blank" rel="noreferrer noopener">
			{m.settings_account_export_button()}<ExternalLink size={14} />
		</Button>
	</Row>
</Card>

<Card icon={CircleAlert} title={m.settings_account_delete_title()} variant="danger">
	<Row
		t={m.settings_account_delete_row()}
		d={m.settings_account_delete_desc()}
	>
		<Button variant="danger" size="sm" onclick={() => launch('delete')}>
			<Trash2 size={14} />{m.settings_account_delete_button()}
		</Button>
	</Row>
</Card>

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
