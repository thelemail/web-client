<script lang="ts">
	import { onMount } from 'svelte';
	import { platform } from '$platform';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AuthShell from '$lib/auth/AuthShell.svelte';
	import PlanStep from '$lib/auth/PlanStep.svelte';
	import { findPlan, planLabelFor, selectionForCode, type PlanSelection } from '$lib/auth/plans';
	import { changePlan, createCheckoutSession, type PlanCode } from '$lib/api/billing';
	import { billing } from '$lib/stores/billing.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Mail from '@lucide/svelte/icons/mail';

	let { data } = $props();

	let sel = $state<PlanSelection>({ product: 'personal', tier: null, seats: 3 });
	let busy = $state(false);
	let checkoutError = $state<string | null>(null);
	let canceledNotice = $state(page.url.searchParams.get('canceled') === '1');
	let switched = $state(false);

	const slot = $derived(data.slot);
	const sub = $derived(billing.subscription);
	const isOwner = $derived(workspaces.isOwner(auth.accountId));
	const alreadyActive = $derived(sub?.status === 'active');
	const paymentProblem = $derived(sub?.status === 'past_due');

	onMount(() => {
		void (async () => {
			const fresh = await billing.refresh();
			if (!workspaces.workspace) {
				await workspaces.load(auth.accountId);
			}
			if (fresh?.status === 'active' && fresh.planCode) {
				const current = selectionForCode(fresh.planCode, Math.max(fresh.seats ?? 3, 3));
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
		const { product } = findPlan(sel);
		return product.perMailbox ? sel.seats !== (sub.seats ?? sel.seats) : false;
	});

	async function switchPlan() {
		if (busy) return;
		const planCode = planCodeFor(sel);
		if (!planCode) return;
		if (!selectionChanged) {
			checkoutError = 'That is already your current plan.';
			return;
		}
		busy = true;
		checkoutError = null;
		try {
			const { product } = findPlan(sel);
			await changePlan({
				planCode,
				seats: product.perMailbox ? sel.seats : undefined
			});
			await billing.refresh();
			await workspaces.load(auth.accountId);
			switched = true;
		} catch (err) {
			checkoutError =
				err instanceof Error ? err.message : 'Could not switch plans. Please try again.';
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
			if (fresh?.entitled && fresh.status !== 'trialing') {
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
				seats: product.perMailbox ? sel.seats : undefined,
				successUrl: `${origin}/u/${slot}/billing/return`,
				cancelUrl: `${origin}/u/${slot}/billing/choose?canceled=1`
			});
			platform.openExternal(url);
		} catch (err) {
			busy = false;
			checkoutError =
				err instanceof Error ? err.message : 'Could not start checkout. Please try again.';
		}
	}

	async function signOut() {
		const id = auth.accountId;
		if (id) await auth.logoutAccount(id);
		await goto('/login');
	}
</script>

<svelte:head>
	<title>Thelemail — Choose a plan</title>
</svelte:head>

{#snippet signOutFoot()}
	<p class="switch">
		Signed in as {auth.email ?? 'this account'}.
		<button type="button" class="linklike" onclick={signOut}>Sign out</button>
	</p>
{/snippet}

<AuthShell>
	<div class="card">
		{#if platform.billing === 'handoff'}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<h1>Choose a plan in your browser</h1>
					<p>
						Plans and payment are handled on the web, where your card details never pass through
						this app. Once you have chosen a plan, come back here and your mailbox will open.
					</p>
					<button
						type="button"
						class="primary"
						onclick={() => platform.openExternal(`${platform.returnOrigin()}/u/${slot}/billing/choose`)}
					>
						Open billing in browser
					</button>
					<button type="button" class="linklike" onclick={() => billing.refresh()}>
						I have chosen a plan
					</button>
				</div>
			</div>
		{:else if switched}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<span class="switch-check"><CircleCheck size={44} strokeWidth={1.5} /></span>
					<h1>Plan updated</h1>
					<p>
						You&rsquo;re now on
						{#if sub?.planCode}<b>{planLabelFor(sub.planCode, sub.seats ?? 1)}</b>{:else}your new plan{/if}.
						The difference is prorated on your next invoice.
					</p>
					<div class="actions" style="margin-top:24px">
						<a class="btn btn-primary btn-block" href={`/u/${slot}/mail/inbox`}>
							<Mail size={17} strokeWidth={1.75} />Open your mailbox
						</a>
					</div>
				</div>
				{@render signOutFoot()}
			</div>
		{:else if alreadyActive && !isOwner}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<h1>You&rsquo;re all set</h1>
					<p>This workspace has an active plan. Only the workspace owner can change it.</p>
					<div class="actions" style="margin-top:24px">
						<a class="btn btn-primary btn-block" href={`/u/${slot}/mail/inbox`}>
							<Mail size={17} strokeWidth={1.75} />Open your mailbox
						</a>
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
				eyebrow="Billing"
				heading="Change your plan"
				ctaVerb="Switch plan"
				busyLabel="Switching your plan…"
				{busy}
				onNext={switchPlan}
				footer={signOutFoot}
			/>
		{:else if paymentProblem}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<h1>Payment problem</h1>
					<p>
						The last payment for this workspace didn&rsquo;t go through. Update your payment
						method from the billing portal to keep your mailbox active.
					</p>
					<div class="actions" style="margin-top:24px">
						<a class="btn btn-primary btn-block" href={`/u/${slot}/settings/account`}>
							Go to Settings &rarr; Manage billing
						</a>
					</div>
				</div>
				{@render signOutFoot()}
			</div>
		{:else if !isOwner && workspaces.workspace}
			<div class="card-surface screen-fade">
				<div class="welcome">
					<h1>Almost there</h1>
					<p>
						This workspace doesn&rsquo;t have an active plan yet. Your workspace owner needs to
						choose a plan before mail is available.
					</p>
				</div>
				{@render signOutFoot()}
			</div>
		{:else}
			{#if canceledNotice}
				<p class="billing-notice">
					<CircleCheck size={15} strokeWidth={1.75} />
					<span>Checkout was cancelled &mdash; nothing was charged. Pick a plan when you&rsquo;re ready.</span>
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
				eyebrow="Activate your mailbox"
				heading="Choose your plan"
				ctaVerb="Continue to secure checkout"
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
