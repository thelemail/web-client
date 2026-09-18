<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import CircleArrowDown from '@lucide/svelte/icons/circle-arrow-down';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import { Button } from '$core/components/ui/button';
	import { auth } from '$core/stores/auth.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { cancelDowngrade, getDowngradePreview, requestDowngrade } from '$core/api/billing';
	import { platform } from '$platform';
	import ImpactList from './ImpactList.svelte';
	import {
		canConfirm,
		formatDay,
		ineligibleMessage,
		parseDowngradePreview,
		storeCancelRequired,
		storeStep,
		targetPlanName
	} from './downgrade';
	import type { DowngradePreview } from '$core/api/billing';

	const slot = $derived(page.params.slot ?? '0');
	const sub = $derived(billing.subscription);
	const planName = $derived(sub?.planCode ? planLabel(sub.planCode) : 'your plan');
	const workspaceName = $derived(workspaces.workspace?.name ?? 'this workspace');

	let preview = $state<DowngradePreview | null>(null);
	let loading = $state(true);
	let busy = $state(false);
	let notice = $state('');
	let done = $state(false);
	let storeOpened = $state(false);

	const target = $derived(targetPlanName(preview));
	const effective = $derived(formatDay(preview?.effectiveAt ?? sub?.currentPeriodEnd));
	const needsStore = $derived(storeCancelRequired(preview));
	const store = $derived(storeStep(sub));
	const confirmable = $derived(canConfirm(preview) && (!needsStore || storeOpened));
	const blocked = $derived(preview?.blocked === true);
	const ineligible = $derived(ineligibleMessage(preview, workspaceName));

	function planLabel(code: string): string {
		return code
			.split('_')
			.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
			.join(' ');
	}

	$effect(() => {
		void load();
	});

	async function load() {
		try {
			preview = parseDowngradePreview(await getDowngradePreview());
		} catch {
			notice = 'We could not work out what would change. Try again in a moment.';
		} finally {
			loading = false;
		}
	}

	async function confirm() {
		busy = true;
		notice = '';
		try {
			await requestDowngrade();
			await billing.refresh();
			if (auth.accountId) await auth.loadProfile(auth.accountId);
			done = true;
		} catch {
			notice = 'We could not schedule the change. Try again in a moment.';
		} finally {
			busy = false;
		}
	}

	async function keepPlan() {
		busy = true;
		notice = '';
		try {
			await cancelDowngrade();
			await billing.refresh();
			if (auth.accountId) await auth.loadProfile(auth.accountId);
			done = false;
			await load();
		} catch {
			notice = 'We could not undo the change. Try again in a moment.';
		} finally {
			busy = false;
		}
	}

	function openStore() {
		if (!store) return;
		storeOpened = true;
		platform.openExternal(store.url);
	}
</script>

{#if loading}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">Change plan</p>
				<h1>Working out what changes</h1>
			</div>
		</div>
	</div>
{:else if done}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="welcome">
				<div class="seal"><Check size={20} /></div>
			</div>
			<div class="card-head">
				<p class="eyebrow">Change plan</p>
				<h1>Scheduled.</h1>
				<p>
					{#if effective}
						On {effective} this workspace moves to {target}. Until then nothing changes.
					{:else}
						This workspace moves to {target} when the current period ends. Until then nothing changes.
					{/if}
				</p>
			</div>
			<p class="lc-mail-confirm">
				<MailCheck size={16} />A confirmation is on its way to {auth.email ?? 'your mailbox'}.
			</p>
			<div class="actions">
				<Button variant="primary" size="lg" block href={`/u/${slot}/mail/inbox`}>
					Back to your mailbox
				</Button>
				<Button variant="ghost" size="lg" block disabled={busy} onclick={keepPlan}>
					Keep {planName} instead
				</Button>
			</div>
			{#if notice}<p class="lc-restore-notice">{notice}</p>{/if}
		</div>
	</div>
{:else if ineligible}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">Plan</p>
				<h1>The plan for {workspaceName}</h1>
				<p>{ineligible}</p>
			</div>
			{#if preview && preview.findings.length > 0}
				<ImpactList {preview} />
			{/if}
			<div class="actions">
				<Button variant="primary" size="lg" block href={`/u/${slot}/mail/inbox`}>
					Back to your mailbox
				</Button>
			</div>
		</div>
	</div>
{:else if preview}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">Change plan</p>
				<h1>Move to the free plan</h1>
				<p>
					{#if effective}
						Your mail stays. Here is what changes on {effective}, the day your {planName} plan ends.
					{:else}
						Your mail stays. Here is what changes when your {planName} plan ends.
					{/if}
				</p>
			</div>

			<div class="osum">
				<span class="os-ic"><CircleArrowDown size={17} /></span>
				<span class="os-text">
					<span class="os-name">{planName} to {target}</span>
					<span class="os-sub">
						{#if effective}
							Takes effect {effective}
						{:else}
							Takes effect at the period end
						{/if}
					</span>
				</span>
				<span class="os-right">
					<span class="os-price mono">€0</span>
				</span>
			</div>

			<ImpactList {preview} />

			{#if needsStore && store}
				<ol class="lc-store-steps">
					<li>
						Open your subscriptions in the {store.label} and turn off renewal for Thelemail {planName}.
					</li>
					<li>Come back and confirm here.</li>
				</ol>
				<div class="actions" style="margin-top:14px">
					<Button variant="secondary" size="lg" block onclick={openStore}>
						<ExternalLink size={16} />Open {store.label}
					</Button>
				</div>
			{/if}

			<div class="lc-offer">
				<span class="of-ic"><CircleArrowDown size={22} /></span>
				<span class="of-tx">
					<b>Staying on {planName}?</b>
					<p>
						Nothing changes if you do nothing here. Your custom domain and storage stay as they are.
					</p>
				</span>
			</div>

			<div class="actions">
				<div class="btnrow">
					<Button
						variant="secondary"
						size="lg"
						class="btn-back"
						aria-label="Back"
						href={`/u/${slot}/mail/inbox`}
					>
						<ArrowLeft />
					</Button>
					<Button variant="primary" size="lg" disabled={busy || !confirmable} onclick={confirm}>
						{#if effective}
							Move to {target} on {effective}
						{:else}
							Move to {target}
						{/if}
					</Button>
				</div>
			</div>

			{#if blocked}
				<p class="lc-lock-note">Sort out the item above to continue.</p>
			{:else if needsStore && !storeOpened}
				<p class="lc-lock-note">Turn off renewal in the {store?.label} first.</p>
			{/if}
			{#if notice}<p class="lc-restore-notice">{notice}</p>{/if}
			<p class="legal">
				Nothing is deleted. You keep {planName} until the date above, and you can undo this from
				Settings any time before then.
			</p>
		</div>
	</div>
{:else}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">Change plan</p>
				<h1>We could not load this</h1>
				<p>{notice}</p>
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block href={`/u/${slot}/mail/inbox`}>
					Back to your mailbox
				</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.lc-restore-notice {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 14px 0 0;
		padding: 11px 14px;
		border: 1px solid var(--danger-500, #b5453a);
		border-radius: var(--radius-md, 8px);
		background: color-mix(in srgb, var(--danger-500, #b5453a) 8%, transparent);
		font-size: var(--text-sm, 13px);
		color: var(--ink-700, #3a4032);
	}
</style>
