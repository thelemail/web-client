<script lang="ts">
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import CircleArrowDown from '@lucide/svelte/icons/circle-arrow-down';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import MailCheck from '@lucide/svelte/icons/mail-check';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import { auth } from '$core/stores/auth.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { cancelDowngrade, getDowngradePreview, requestDowngrade } from '$core/api/billing';
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
	const planName = $derived(sub?.planCode ? planLabel(sub.planCode) : m.lc_downgrade_your_plan());
	const workspaceName = $derived(workspaces.workspace?.name ?? m.lc_downgrade_this_workspace());

	let preview = $state<DowngradePreview | null>(null);
	let loading = $state(true);
	let busy = $state(false);
	let notice = $state('');
	let done = $state(false);

	const target = $derived(targetPlanName(preview));
	const effective = $derived(formatDay(preview?.effectiveAt ?? sub?.currentPeriodEnd));
	const needsStore = $derived(storeCancelRequired(preview));
	const store = $derived(storeStep(sub));
	const confirmable = $derived(canConfirm(preview));
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
			notice = m.lc_downgrade_load_failed();
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
			notice = m.lc_downgrade_schedule_failed();
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
			notice = m.lc_downgrade_undo_failed();
		} finally {
			busy = false;
		}
	}

</script>

{#if loading}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_downgrade_eyebrow()}</p>
				<h1>{m.lc_downgrade_loading_title()}</h1>
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
				<p class="eyebrow">{m.lc_downgrade_eyebrow()}</p>
				<h1>{m.lc_downgrade_done_title()}</h1>
				<p>
					{#if effective}
						{m.lc_downgrade_done_on({ date: effective, plan: target })}
					{:else}
						{m.lc_downgrade_done_period_end({ plan: target })}
					{/if}
				</p>
			</div>
			<p class="lc-mail-confirm">
				<MailCheck size={16} />{m.lc_downgrade_done_email({
					email: auth.email ?? m.lc_downgrade_your_mailbox()
				})}
			</p>
			<div class="actions">
				<Button variant="primary" size="lg" block href={`/u/${slot}/mail/inbox`}>
					{m.lc_back_to_your_mailbox()}
				</Button>
				<Button variant="ghost" size="lg" block disabled={busy} onclick={keepPlan}>
					{m.lc_downgrade_keep({ plan: planName })}
				</Button>
			</div>
			{#if notice}<p class="lc-restore-notice">{notice}</p>{/if}
		</div>
	</div>
{:else if ineligible}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_downgrade_plan_eyebrow()}</p>
				<h1>{m.lc_downgrade_plan_for({ workspace: workspaceName })}</h1>
				<p>{ineligible}</p>
			</div>
			{#if preview && preview.findings.length > 0}
				<ImpactList {preview} />
			{/if}
			<div class="actions">
				<Button variant="primary" size="lg" block href={`/u/${slot}/mail/inbox`}>
					{m.lc_back_to_your_mailbox()}
				</Button>
			</div>
		</div>
	</div>
{:else if preview}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_downgrade_eyebrow()}</p>
				<h1>{m.lc_downgrade_title()}</h1>
				<p>
					{#if effective}
						{m.lc_downgrade_intro_on({ date: effective, plan: planName })}
					{:else}
						{m.lc_downgrade_intro_period_end({ plan: planName })}
					{/if}
				</p>
			</div>

			<div class="osum">
				<span class="os-ic"><CircleArrowDown size={17} /></span>
				<span class="os-text">
					<span class="os-name">{m.lc_downgrade_from_to({ from: planName, to: target })}</span>
					<span class="os-sub">
						{#if effective}
							{m.lc_downgrade_effective_on({ date: effective })}
						{:else}
							{m.lc_downgrade_effective_period_end()}
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
						{m.lc_downgrade_store_step_turn_off({ store: store.label, plan: planName })}
					</li>
					<li>
						{m.lc_downgrade_store_step_confirm({ store: store.label })}
					</li>
				</ol>
				<div class="actions" style="margin-top:14px">
					<Button
						variant="secondary"
						size="lg"
						block
						href={store.url}
						target="_blank"
						rel="noopener noreferrer"
					>
						<ExternalLink size={16} />{m.lc_downgrade_store_open({ store: store.label })}
					</Button>
				</div>
			{/if}

			<div class="lc-offer">
				<span class="of-ic"><CircleArrowDown size={22} /></span>
				<span class="of-tx">
					<b>{m.lc_downgrade_staying_title({ plan: planName })}</b>
					<p>
						{m.lc_downgrade_staying_body()}
					</p>
				</span>
			</div>

			<div class="actions">
				<div class="btnrow">
					<Button
						variant="secondary"
						size="lg"
						class="btn-back"
						aria-label={m.common_back()}
						href={`/u/${slot}/mail/inbox`}
					>
						<ArrowLeft />
					</Button>
					<Button variant="primary" size="lg" disabled={busy || !confirmable} onclick={confirm}>
						{#if effective}
							{m.lc_downgrade_confirm_on({ plan: target, date: effective })}
						{:else}
							{m.lc_downgrade_confirm({ plan: target })}
						{/if}
					</Button>
				</div>
			</div>

			{#if blocked}
				<p class="lc-lock-note">{m.lc_downgrade_blocked()}</p>
			{/if}
			{#if notice}<p class="lc-restore-notice">{notice}</p>{/if}
			<p class="legal">
				{m.lc_downgrade_legal({ plan: planName })}
			</p>
		</div>
	</div>
{:else}
	<div class="card lc-mid">
		<div class="card-surface screen-fade">
			<div class="card-head">
				<p class="eyebrow">{m.lc_downgrade_eyebrow()}</p>
				<h1>{m.lc_downgrade_load_error_title()}</h1>
				<p>{notice}</p>
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block href={`/u/${slot}/mail/inbox`}>
					{m.lc_back_to_your_mailbox()}
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
