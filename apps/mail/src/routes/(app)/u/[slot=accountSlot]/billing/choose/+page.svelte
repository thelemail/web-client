<script lang="ts">
	import { onMount } from 'svelte';
	import { platform } from '$platform';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import PlanStep from '$core/auth/PlanStep.svelte';
	import { findPlan, planLabelFor, selectionForCode, type PlanSelection } from '$core/auth/plans';
	import { changePlan, createCheckoutSession, type PlanCode } from '$core/api/billing';
	import { billing } from '$core/stores/billing.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Mail from '@lucide/svelte/icons/mail';
	import { Button } from '$core/components/ui/button';
	import { entryPointVisible } from '$core/lifecycle/downgrade';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';

	let { data } = $props();

	let sel = $state<PlanSelection>({ product: 'personal', tier: null, seats: 3, period: 'year' });
	let busy = $state(false);
	let checkoutError = $state<string | null>(null);
	let canceledNotice = $state(page.url.searchParams.get('canceled') === '1');
	let switched = $state(false);

	const slot = $derived(data.slot);
	const sub = $derived(billing.subscription);
	const isOwner = $derived(workspaces.isOwner(auth.accountId));
	const isFree = $derived(billing.isFree);
	const alreadyActive = $derived(sub?.status === 'active' && !isFree);
	const paymentProblem = $derived(sub?.status === 'past_due');
	const canMoveToFree = $derived(isOwner && entryPointVisible(sub));

	onMount(() => {
		void (async () => {
			const fresh = await billing.refresh();
			if (!workspaces.workspace) {
				await workspaces.load(auth.accountId);
			}
			if (fresh?.status === 'active' && fresh.planCode) {
				const current = selectionForCode(
					fresh.planCode,
					Math.max(fresh.seats ?? 3, 3),
					fresh.interval ?? 'year'
				);
				if (current) {
					sel = current;
					return;
				}
			}
			const wsType = workspaces.workspace?.type;
			if (wsType && !sel.tier && sel.product !== wsType) {
				sel = { ...sel, product: wsType };
			}
		})();
	});

	function planCodeFor(selection: PlanSelection): PlanCode | null {
		const { tier } = findPlan(selection);
		if (!tier) return null;
		return tier.id.replace(/-/g, '_') as PlanCode;
	}

	const selectionChanged = $derived.by(() => {
		if (!sub || sub.status !== 'active') return true;
		const code = planCodeFor(sel);
		if (!code) return false;
		if (code !== sub.planCode) return true;
		if (sel.period !== (sub.interval ?? 'year')) return true;
		const { product } = findPlan(sel);
		return product.perMailbox ? sel.seats !== (sub.seats ?? sel.seats) : false;
	});

	async function switchPlan() {
		if (busy) return;
		const planCode = planCodeFor(sel);
		if (!planCode) return;
		if (!selectionChanged) {
			checkoutError = m.billing_choose_already_current();
			return;
		}
		busy = true;
		checkoutError = null;
		try {
			const { product } = findPlan(sel);
			await changePlan({
				planCode,
				interval: sel.period,
				seats: product.perMailbox ? sel.seats : undefined
			});
			await billing.refresh();
			await workspaces.load(auth.accountId);
			switched = true;
		} catch (err) {
			checkoutError =
				err instanceof Error ? err.message : m.billing_choose_switch_failed();
		} finally {
			busy = false;
		}
	}

	async function startCheckout() {
		if (busy) return;
		const planCode = planCodeFor(sel);
		if (!planCode) return;
		busy = true;
		checkoutError = null;
		canceledNotice = false;
		try {
			const fresh = await billing.refresh();
			if (fresh?.entitled && fresh.planCode !== 'free') {
				await goto(`/u/${slot}/mail/inbox`);
				return;
			}
			const { product } = findPlan(sel);
			if (workspaces.workspace && workspaces.workspace.type !== product.id) {
				await workspaces.changeType({ type: product.id });
			}
			const origin = platform.returnOrigin();
			const { url } = await createCheckoutSession({
				planCode,
				interval: sel.period,
				seats: product.perMailbox ? sel.seats : undefined,
				successUrl: `${origin}/u/${slot}/billing/return`,
				cancelUrl: `${origin}/u/${slot}/billing/choose?canceled=1`
			});
			platform.openExternal(url);
		} catch (err) {
			busy = false;
			checkoutError =
				err instanceof Error ? err.message : m.billing_choose_checkout_failed();
		}
	}

	async function signOut() {
		const id = auth.accountId;
		if (id) await auth.logoutAccount(id);
		await goto('/login');
	}
</script>

<svelte:head>
	<title>{m.billing_choose_page_title()}</title>
</svelte:head>

{#snippet signOutFoot()}
	<p class="switch">
		{m.billing_choose_signed_in_as({ email: auth.email ?? m.billing_choose_this_account() })}
		<button type="button" class="linklike" onclick={signOut}>{m.billing_choose_sign_out()}</button>
	</p>
{/snippet}

{#snippet bold(text: string)}<b>{text}</b>{/snippet}

<AuthShell>
	<div class="card">
		{#if platform.billing === 'handoff'}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<h1>{m.billing_choose_handoff_title()}</h1>
					<p>
						{m.billing_choose_handoff_body()}
					</p>
					<button
						type="button"
						class="primary"
						onclick={() => platform.openExternal(`${platform.returnOrigin()}/u/${slot}/billing/choose`)}
					>
						{m.billing_choose_handoff_open()}
					</button>
					<button type="button" class="linklike" onclick={() => billing.refresh()}>
						{m.billing_choose_handoff_done()}
					</button>
				</div>
			</div>
		{:else if switched}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<span class="switch-check"><CircleCheck size={44} strokeWidth={1.5} /></span>
					<h1>{m.billing_choose_switched_title()}</h1>
					<p>
						{#if sub?.planCode}
							<Rich
								text={m.billing_choose_switched_plan({
									plan: planLabelFor(sub.planCode, sub.seats ?? 1, sub.interval ?? 'year')
								})}
								tags={{ b: bold }}
							/>
						{:else}
							{m.billing_choose_switched_generic()}
						{/if}
					</p>
					<div class="actions" style="margin-top:24px">
						<Button variant="primary" size="lg" block href={`/u/${slot}/mail/inbox`}>
							<Mail size={17} strokeWidth={1.75} />{m.billing_open_mailbox()}
						</Button>
					</div>
				</div>
				{@render signOutFoot()}
			</div>
		{:else if alreadyActive && !isOwner}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<h1>{m.billing_choose_member_active_title()}</h1>
					<p>{m.billing_choose_member_active_body()}</p>
					<div class="actions" style="margin-top:24px">
						<Button variant="primary" size="lg" block href={`/u/${slot}/mail/inbox`}>
							<Mail size={17} strokeWidth={1.75} />{m.billing_open_mailbox()}
						</Button>
					</div>
				</div>
				{@render signOutFoot()}
			</div>
		{:else if alreadyActive}
			{#if checkoutError}
				<p class="billing-notice billing-notice-error">
					<CircleAlert size={15} strokeWidth={1.75} />
					<span>{checkoutError}</span>
				</p>
			{/if}
			<PlanStep
				bind:sel
				showStepper={false}
				eyebrow={m.billing_choose_change_eyebrow()}
				heading={m.billing_choose_change_heading()}
				ctaVerb={m.billing_choose_change_cta()}
				busyLabel={m.billing_choose_change_busy()}
				{busy}
				onNext={switchPlan}
				footer={signOutFoot}
			/>
		{:else if paymentProblem}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<h1>{m.billing_choose_past_due_title()}</h1>
					<p>
						{m.billing_choose_past_due_body()}
					</p>
					<div class="actions" style="margin-top:24px">
						<Button variant="primary" size="lg" block href={`/u/${slot}/settings/account`}>
							{m.billing_choose_past_due_settings()}
						</Button>
						{#if canMoveToFree}
							<Button variant="ghost" size="lg" block href={`/u/${slot}/lifecycle/downgrade`}>
								{m.billing_choose_move_to_free()}
							</Button>
						{/if}
					</div>
				</div>
				{@render signOutFoot()}
			</div>
		{:else if !isOwner && workspaces.workspace}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<h1>{m.billing_choose_member_pending_title()}</h1>
					<p>
						{m.billing_choose_member_pending_body()}
					</p>
				</div>
				{@render signOutFoot()}
			</div>
		{:else}
			{#if canceledNotice}
				<p class="billing-notice">
					<CircleCheck size={15} strokeWidth={1.75} />
					<span>{m.billing_choose_canceled_notice()}</span>
				</p>
			{/if}
			{#if checkoutError}
				<p class="billing-notice billing-notice-error">
					<CircleAlert size={15} strokeWidth={1.75} />
					<span>{checkoutError}</span>
				</p>
			{/if}
			<PlanStep
				bind:sel
				showStepper={false}
				eyebrow={isFree ? m.billing_choose_upgrade_eyebrow() : m.billing_choose_activate_eyebrow()}
				heading={isFree ? m.billing_choose_upgrade_heading() : m.billing_choose_activate_heading()}
				ctaVerb={m.billing_choose_checkout_cta()}
				{busy}
				onNext={startCheckout}
				footer={signOutFoot}
			/>
		{/if}
	</div>
</AuthShell>

<style>
	.switch-check {
		display: inline-flex;
		margin-bottom: 8px;
		color: var(--success-500);
	}
</style>
