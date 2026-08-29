<script lang="ts">
	import Globe2 from '@lucide/svelte/icons/globe-2';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';

	import Card from '$lib/settings/Card.svelte';
	import Badge from '$lib/settings/Badge.svelte';
	import SecHead from '$lib/settings/SecHead.svelte';
	import RecordList from '$lib/settings/domains/RecordList.svelte';
	import {
		DOMAIN_STEPS,
		inboundLive,
		resumeStep,
		statusKind,
		statusLabel,
		stepComplete,
		type DomainStep
	} from '$lib/settings/domains/steps';
	import { customDomains as store } from '$lib/stores/customDomains.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import type { CustomDomain } from '$lib/api/customDomains';

	const POLL_MS = 60000;

	const slot = $derived(page.params.slot ?? '0');
	const base = $derived(`/u/${slot}/settings/domains`);
	const LADDER = DOMAIN_STEPS.filter((s) => s !== 'done');

	const open = new SvelteSet<string>();
	const busy = new SvelteSet<string>();

	function toggle(id: string) {
		if (open.has(id)) open.delete(id);
		else {
			open.add(id);
			void ensureRecords(id);
		}
	}

	async function ensureRecords(id: string) {
		const ws = workspaces.workspace?.id;
		if (!ws) return;
		if (store.records.has(id)) return;
		try {
			await store.fetchDetail(ws, id);
		} catch {
		}
	}

	async function recheck(id: string) {
		const ws = workspaces.workspace?.id;
		if (!ws || busy.has(id)) return;
		busy.add(id);
		try {
			await store.verify(ws, id);
		} catch (err) {
			console.warn('verify failed', err);
		} finally {
			busy.delete(id);
		}
	}

	async function remove(id: string) {
		const ws = workspaces.workspace?.id;
		if (!ws) return;
		if (!confirm('Remove this domain? Mail addressed to it will stop being accepted.'))
			return;
		busy.add(id);
		try {
			await store.remove(ws, id);
			open.delete(id);
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

	function canManage(): boolean {
		return workspaces.canManage();
	}

	const empty = $derived(!store.loading && store.items.length === 0);
	const items = $derived(store.items);
	const manage = $derived(canManage());
	const anyInSetup = $derived(items.some((d) => !inboundLive(d)));

	function setupHref(d: CustomDomain, step?: DomainStep): string {
		return `${base}/${d.id}?step=${step ?? resumeStep(d)}`;
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
	desc="Add domains you own. The Ownership TXT proves DNS control — without it, anyone whose DNS happens to point at Thelemail could be claimed by another user. Keep the Ownership record published for as long as you use the domain."
/>

<Card>
	{#snippet head()}
		<Globe2 size={16} />
		<h3>Your domains</h3>
	{/snippet}

	{#if store.loading && items.length === 0}
		<div class="cd-empty">Loading domains…</div>
	{:else if empty}
		<div class="cd-empty">
			No custom domains yet. Add one to see what DNS records you'll need to publish.
		</div>
	{:else}
		<div class="cd-list">
			{#each items as d (d.id)}
				{@const isOpen = open.has(d.id)}
				{@const isBusy = busy.has(d.id)}
				{@const records = store.records.get(d.id) ?? []}
				<div class="cd-row">
					<button type="button" class="cd-head" onclick={() => toggle(d.id)} aria-expanded={isOpen}>
						<span class="cd-chev">
							{#if isOpen}
								<ChevronDown size={14} />
							{:else}
								<ChevronRight size={14} />
							{/if}
						</span>
						<span class="cd-name mono">{d.domain}</span>
						<span class="cd-ladder dw-ladder" aria-hidden="true">
							{#each LADDER as s (s)}
								<span
									class="dw-pip"
									class:on={stepComplete(d, s)}
									class:fail={d.status === 'failed' && s === 'routing' && !stepComplete(d, s)}
								></span>
							{/each}
						</span>
						<span class="cd-badge"><Badge kind={statusKind(d.status)} dot>{statusLabel(d.status)}</Badge></span>
						<span class="cd-meta">checked {formatTime(d.lastCheckedAt)}</span>
					</button>
					{#if isOpen}
						<div class="cd-body">
							{#if d.lastError}
								<div class="cd-err">
									<CircleAlert size={14} /><span>{d.lastError}</span>
								</div>
							{/if}
							{#if records.length === 0}
								<div class="cd-empty subtle">Loading DNS records…</div>
							{:else}
								<RecordList {records} />
							{/if}
							<div class="cd-actions">
								{#if !inboundLive(d)}
									<a class="btn btn-secondary" href={setupHref(d)}>
										Continue setup<ArrowRight size={15} />
									</a>
								{/if}
								<button
									type="button"
									class="btn btn-secondary"
									disabled={!manage || isBusy}
									onclick={() => recheck(d.id)}
								>
									<RefreshCw size={14} />
									{isBusy ? 'Checking…' : 'Re-check DNS'}
								</button>
								<button
									type="button"
									class="btn btn-ghost danger"
									disabled={!manage || isBusy}
									onclick={() => remove(d.id)}
								>
									<Trash2 size={14} />Remove
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<div class="cd-foot">
		<a class="btn btn-primary" href={`${base}/new`}><Plus size={15} />Add a domain</a>
	</div>

	{#if store.error}
		<div class="cd-err">
			<CircleAlert size={14} /><span>{store.error}</span>
		</div>
	{/if}
</Card>

<style>
	.cd-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.cd-row {
		border: 1px solid var(--line, rgba(0, 0, 0, 0.08));
		border-radius: 8px;
		background: var(--surface, #fff);
	}
	.cd-head {
		display: grid;
		grid-template-columns: 18px 1fr auto auto auto;
		gap: 10px;
		align-items: center;
		width: 100%;
		padding: 12px 14px;
		background: transparent;
		border: 0;
		cursor: pointer;
		text-align: left;
	}
	.cd-chev {
		display: inline-flex;
		justify-content: center;
		color: var(--ink-2, rgba(0, 0, 0, 0.5));
	}
	.cd-name {
		font-weight: 600;
	}
	.cd-meta {
		font-size: 12px;
		color: var(--ink-2, rgba(0, 0, 0, 0.5));
	}
	.cd-body {
		padding: 14px;
		border-top: 1px solid var(--line, rgba(0, 0, 0, 0.06));
	}
	.cd-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		align-items: center;
		margin-top: 14px;
	}
	.cd-foot {
		display: flex;
		justify-content: flex-start;
		padding: 14px 18px;
		border-top: 1px solid var(--border);
	}
	.cd-empty {
		padding: 14px;
		text-align: center;
		color: var(--ink-2, rgba(0, 0, 0, 0.5));
		font-size: 13px;
	}
	.cd-empty.subtle {
		text-align: left;
		padding: 8px 0;
	}
	.cd-err {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 8px 12px;
		margin-top: 8px;
		background: var(--warn-bg, rgba(220, 80, 50, 0.06));
		color: var(--warn, #b25030);
		border-radius: 6px;
		font-size: 12px;
	}
</style>
