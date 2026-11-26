<script lang="ts">
	import LoadState from '$core/components/LoadState.svelte';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowRight,
		faCircleExclamation,
		faEarthEurope,
		faEllipsisVertical,
		faPlus,
		faTrashCan
	} from '@fortawesome/pro-regular-svg-icons';
	import { page } from '$app/state';

	import Card from '$core/settings/Card.svelte';
	import { Badge } from '$core/components/ui/badge';
	import SecHead from '$core/settings/SecHead.svelte';
	import RemoveDomainDialog from '$core/settings/domains/RemoveDomainDialog.svelte';
	import {
		DOMAIN_STEPS,
		STEP_LABELS,
		resumeStep,
		domainBadge,
		stepComplete,
		stepRunning,
		checkRunning,
		ownershipLapsing,
		reasonMessage,
		reasonStands
	} from '$core/settings/domains/steps';
	import { pollWhileVisible } from '$core/settings/domains/poll';
	import { serverNow } from '$core/api/serverclock';
	import { formatMoment, timeSince } from '$core/i18n/relative';
	import { customDomains as store } from '$core/stores/customDomains.svelte';
	import { settingsDraft } from '$core/stores/settingsDraft.svelte';
	import { workspaces } from '$core/stores/workspaces.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import UpgradeNudge from '$core/settings/UpgradeNudge.svelte';
	import type { CustomDomain } from '$core/api/customDomains';
	import { Button } from '$core/components/ui/button';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import { m } from '$paraglide/messages.js';

	const LIST_POLL_MS = 60_000;
	const CLOCK_MS = 30_000;

	const slot = $derived(page.params.slot ?? '0');
	const base = $derived(`/u/${slot}/settings/domains`);
	const LADDER = DOMAIN_STEPS.filter((s) => s !== 'done');

	let removeId = $state<string | null>(null);
	let now = $state(serverNow());

	const removeTarget = $derived(store.items.find((d) => d.id === removeId) ?? null);

	function startRemove(id: string) {
		removeId = id;
	}

	const empty = $derived(store.loaded && store.items.length === 0);
	const items = $derived(store.items);
	const manage = $derived(workspaces.canManage());
	const anyRunning = $derived(items.some(checkRunning));

	function setupHref(d: CustomDomain): string {
		return `${base}/${d.id}?step=${resumeStep(d)}`;
	}

	function remaining(d: CustomDomain): number {
		return LADDER.filter((s) => !stepComplete(d, s)).length;
	}

	function since(at: string | null | undefined): string {
		return at ? timeSince(at, now) : m.settings_domains_never();
	}

	function reason(d: CustomDomain): string | null {
		const code = d.check?.result ?? d.lastError;
		return reasonStands(d, code) ? reasonMessage(code) : null;
	}

	function meta(d: CustomDomain): string {
		const c = d.check;
		if (ownershipLapsing(d) && d.releaseAt) {
			const deadline = formatMoment(d.releaseAt);
			return manage
				? m.settings_domains_meta_lapsing({ deadline })
				: m.settings_domains_meta_lapsing_member({ deadline });
		}
		if (c?.state === 'running') {
			return m.settings_domains_meta_running({
				deadline: formatMoment(c.deadlineAt),
				when: since(c.lastCheckedAt)
			});
		}
		if (c?.state === 'expired') return m.settings_domains_meta_expired({ when: timeSince(c.deadlineAt, now) });
		if (stepComplete(d, 'done')) return m.settings_domains_checked({ time: since(d.lastCheckedAt) });
		return m.settings_domains_steps_left({ count: remaining(d), time: since(d.lastCheckedAt) });
	}

	$effect(() => {
		const t = setInterval(() => (now = serverNow()), CLOCK_MS);
		return () => clearInterval(t);
	});

	$effect(() => {
		if (!anyRunning) return;
		const ws = workspaces.workspace?.id;
		if (!ws) return;
		return pollWhileVisible(() => store.refresh(ws), LIST_POLL_MS);
	});
</script>

<SecHead desc={m.settings_domains_desc()} />

<Card icon={faEarthEurope} title={m.settings_domains_title()}>

	{#if !store.loaded && store.error}
		<LoadState
			kind="error"
			label={store.error}
			onRetry={() => void store.load(workspaces.workspace?.id ?? null)}
		/>
	{:else if !store.loaded}
		<LoadState kind="loading" label={m.settings_domains_loading()} />
	{:else if empty}
		<div class="cd-empty">{m.settings_domains_empty()}</div>
	{:else}
		<div class="cd-list">
			{#each items as d (d.id)}
				{@const badge = domainBadge(d)}
				{@const live = badge.state === 'live'}
				{@const why = reason(d)}
				<div class="cd-row" class:live>
					<div class="cd-main">
						<span class="cd-name mono">{d.domain}</span>
						<Badge tone={badge.kind} status>{badge.label}</Badge>
					</div>

					<div class="cd-progress" aria-label={m.settings_domains_progress_aria()}>
						{#each LADDER as s (s)}
							<span
								class="cd-stage"
								class:done={stepComplete(d, s)}
								class:run={stepRunning(d, s)}
								class:warn={s === 'ownership' && ownershipLapsing(d)}
							>
								<span class="cd-pip"></span>
								<span class="cd-stage-lbl">{STEP_LABELS[s]()}</span>
							</span>
						{/each}
					</div>

					{#if why}
						<div class="cd-err"><Icon icon={faCircleExclamation} size={14} /><span>{why}</span></div>
					{/if}

					<div class="cd-foot-row">
						<span class="cd-meta">{meta(d)}</span>
						<span class="cd-acts">
							{#if live}
								<Button variant="tonal" href={setupHref(d)}>{m.settings_domains_review_setup()}</Button>
							{:else}
								<Button variant="primary" href={setupHref(d)}>
									{m.settings_domains_continue_setup()}<Icon icon={faArrowRight} size={15} />
								</Button>
							{/if}
							{#if manage}
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button {...props} variant="ghost" size="icon-sm" aria-label={m.settings_domains_actions_aria()}>
												<Icon icon={faEllipsisVertical} size={16} />
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										<DropdownMenu.Item variant="danger" onSelect={() => startRemove(d.id)}>
											<Icon icon={faTrashCan} size={14} />{m.settings_domains_remove()}
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							{/if}
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<div class="cd-card-foot">
		{#if !billing.canAddDomains}
			<UpgradeNudge
				title={m.settings_domains_nudge_title()}
				desc={m.settings_domains_nudge_desc()}
			/>
		{:else}
			<Button variant="primary" href={`${base}/new`}><Icon icon={faPlus} size={15} />{m.settings_domains_add()}</Button>
		{/if}
	</div>

	{#if store.loaded && store.error}
		<div class="cd-err cd-err-card">
			<Icon icon={faCircleExclamation} size={14} /><span>{store.error}</span>
		</div>
	{/if}
</Card>

{#if removeTarget}
	<RemoveDomainDialog
		domain={removeTarget}
		onClose={() => (removeId = null)}
		onRemoved={(name) => settingsDraft.flash(m.settings_domains_removed_flash({ name }))}
	/>
{/if}

<style>
	.cd-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px 18px;
	}
	.cd-row {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 15px 16px;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-surface);
		background: var(--surface);
	}
	.cd-row.live {
		border-color: var(--border);
		background: var(--bg-raised);
	}
	.cd-main {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.cd-name {
		font-weight: 600;
		font-size: 14px;
	}
	.cd-progress {
		display: flex;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}
	.cd-stage {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.cd-pip {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--border-strong);
		flex: 0 0 auto;
	}
	.cd-stage.done .cd-pip {
		background: var(--success-500);
	}
	.cd-stage.run .cd-pip {
		background: var(--pine-500);
	}
	.cd-stage.warn .cd-pip {
		background: var(--warning-500);
	}
	.cd-stage-lbl {
		font-size: 11.5px;
		color: var(--fg-faint);
	}
	.cd-stage.done .cd-stage-lbl {
		color: var(--fg-muted);
	}
	.cd-foot-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.cd-meta {
		font-size: 11.5px;
		color: var(--fg-faint);
	}
	.cd-acts {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
	}

	.cd-empty {
		padding: 18px;
		text-align: center;
		color: var(--fg-muted);
		font-size: 13px;
	}
	.cd-err {
		display: flex;
		gap: 7px;
		align-items: flex-start;
		padding: 9px 12px;
		background: var(--warning-100);
		color: var(--warning-700);
		border-radius: var(--radius-control);
		font-size: 12px;
		line-height: 1.5;
	}
	.cd-err-card {
		margin: 0 18px 16px;
	}
	.cd-card-foot {
		display: flex;
		padding: 14px 18px;
		border-top: 1px solid var(--border);
	}
</style>
