<script lang="ts">
	import Globe2 from '@lucide/svelte/icons/globe-2';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';

	import Card from '$lib/settings/Card.svelte';
	import Badge from '$lib/settings/Badge.svelte';
	import SecHead from '$lib/settings/SecHead.svelte';
	import {
		DOMAIN_STEPS,
		STEP_LABELS,
		inboundLive,
		resumeStep,
		statusKind,
		statusLabel,
		stepComplete
	} from '$lib/settings/domains/steps';
	import { customDomains as store } from '$lib/stores/customDomains.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import type { CustomDomain } from '$lib/api/customDomains';

	const POLL_MS = 60000;

	const slot = $derived(page.params.slot ?? '0');
	const base = $derived(`/u/${slot}/settings/domains`);
	const LADDER = DOMAIN_STEPS.filter((s) => s !== 'done');

	const busy = new SvelteSet<string>();

	async function remove(id: string) {
		const ws = workspaces.workspace?.id;
		if (!ws) return;
		if (!confirm('Remove this domain? Mail addressed to it will stop being accepted.')) return;
		busy.add(id);
		try {
			await store.remove(ws, id);
		} finally {
			busy.delete(id);
		}
	}

	function formatTime(s: string | null | undefined): string {
		if (!s) return 'never';
		const d = new Date(s);
		if (Number.isNaN(d.getTime())) return 'never';
		return d.toLocaleString();
	}

	const empty = $derived(!store.loading && store.items.length === 0);
	const items = $derived(store.items);
	const manage = $derived(workspaces.canManage());
	const anyInSetup = $derived(items.some((d) => !inboundLive(d)));

	function setupHref(d: CustomDomain): string {
		return `${base}/${d.id}?step=${resumeStep(d)}`;
	}

	function remaining(d: CustomDomain): number {
		return LADDER.filter((s) => !stepComplete(d, s)).length;
	}

	$effect(() => {
		if (!anyInSetup) return;
		const ws = workspaces.workspace?.id;
		if (!ws) return;
		const t = setInterval(() => void store.load(ws), POLL_MS);
		return () => clearInterval(t);
	});
</script>

<SecHead
	title="Domains you own"
	desc="Setup runs in a fixed order so mail never arrives somewhere it cannot be delivered: prove you own the domain, set up sending, create the addresses that will receive mail, then point MX here last."
/>

<Card>
	{#snippet head()}
		<Globe2 size={16} />
		<h3>Your domains</h3>
	{/snippet}

	{#if store.loading && items.length === 0}
		<div class="cd-empty">Loading domains…</div>
	{:else if empty}
		<div class="cd-empty">No custom domains yet.</div>
	{:else}
		<div class="cd-list">
			{#each items as d (d.id)}
				{@const isBusy = busy.has(d.id)}
				{@const live = inboundLive(d)}
				{@const left = remaining(d)}
				<div class="cd-row" class:live>
					<div class="cd-main">
						<span class="cd-name mono">{d.domain}</span>
						<Badge kind={statusKind(d.status)} dot>{statusLabel(d.status)}</Badge>
					</div>

					<div class="cd-progress" aria-label="Setup progress">
						{#each LADDER as s (s)}
							<span class="cd-stage" class:done={stepComplete(d, s)}>
								<span class="cd-pip"></span>
								<span class="cd-stage-lbl">{STEP_LABELS[s]}</span>
							</span>
						{/each}
					</div>

					{#if d.lastError}
						<div class="cd-err"><CircleAlert size={14} /><span>{d.lastError}</span></div>
					{/if}

					<div class="cd-foot-row">
						<span class="cd-meta">
							{#if live}
								Checked {formatTime(d.lastCheckedAt)}
							{:else}
								{left} step{left === 1 ? '' : 's'} left · checked {formatTime(d.lastCheckedAt)}
							{/if}
						</span>
						<span class="cd-acts">
							<button
								type="button"
								class="btn btn-ghost danger btn-sm"
								disabled={!manage || isBusy}
								onclick={() => remove(d.id)}
							>
								<Trash2 size={14} />Remove
							</button>
							{#if live}
								<a class="btn btn-secondary" href={setupHref(d)}>Review setup</a>
							{:else}
								<a class="btn btn-primary" href={setupHref(d)}>
									Continue setup<ArrowRight size={15} />
								</a>
							{/if}
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<div class="cd-card-foot">
		<a class="btn btn-primary" href={`${base}/new`}><Plus size={15} />Add a domain</a>
	</div>

	{#if store.error}
		<div class="cd-err cd-err-card">
			<CircleAlert size={14} /><span>{store.error}</span>
		</div>
	{/if}
</Card>

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
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.cd-row.live {
		border-color: var(--border);
		background: var(--paper-50);
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
		background: var(--paper-200);
		flex: 0 0 auto;
	}
	.cd-stage.done .cd-pip {
		background: var(--success-500);
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
