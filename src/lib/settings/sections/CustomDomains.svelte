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
	import CopyBtn from '$lib/settings/CopyBtn.svelte';
	import DnsChip from '$lib/settings/DnsChip.svelte';
	import SecHead from '$lib/settings/SecHead.svelte';
	import {
		DOMAIN_STEPS,
		STEP_LABELS,
		inboundLive,
		resumeStep,
		statusKind,
		statusLabel,
		stepComplete,
		type DomainStep
	} from '$lib/settings/domains/steps';
	import { customDomains as store } from '$lib/stores/customDomains.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import type { CustomDomain, DNSRecordStatus } from '$lib/api/customDomains';

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

	function chipKind(s: DNSRecordStatus): 'ok' | 'warn' | 'fail' | 'pending' {
		switch (s) {
			case 'ok':
				return 'ok';
			case 'missing':
				return 'pending';
			case 'mismatch':
				return 'fail';
			default:
				return 'pending';
		}
	}

	function recordLabel(kind: string): string {
		switch (kind) {
			case 'ownership':
				return 'Ownership verification';
			case 'mx':
				return 'Inbound mail (MX)';
			case 'dkim':
				return 'DKIM signing';
			case 'spf':
				return 'SPF';
			case 'dmarc':
				return 'DMARC';
			case 'wkd':
				return 'Key discovery (WKD)';
			default:
				return kind;
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
								<table class="cd-tbl">
									<thead>
										<tr>
											<th>Record</th>
											<th>Type</th>
											<th>Host</th>
											<th>Value</th>
											<th>State</th>
										</tr>
									</thead>
									<tbody>
										{#each records as r (r.kind + r.host)}
											<tr>
												<td>
													{recordLabel(r.kind)}
													{#if !r.required}
														<span class="cd-opt">optional</span>
													{/if}
												</td>
												<td class="mono">{r.type}</td>
												<td class="mono cd-trunc"><code>{r.host}</code></td>
												<td class="cd-val">
													<code>{r.value}</code>
													<CopyBtn text={r.value} small />
												</td>
												<td><DnsChip kind={chipKind(r.status)} /></td>
											</tr>
										{/each}
									</tbody>
								</table>
							{/if}
							<div class="cd-steps">
								{#each LADDER as s (s)}
									<a class="cd-step" class:done={stepComplete(d, s)} href={setupHref(d, s)}>
										{STEP_LABELS[s]}
									</a>
								{/each}
							</div>
							<div class="cd-actions">
								{#if !inboundLive(d)}
									<a class="btn btn-primary" href={setupHref(d)}>
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

	<div class="cd-add">
		<a class="btn btn-secondary" href={`${base}/new`}><Plus size={15} />Add a domain</a>
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
		padding: 4px 14px 14px;
		border-top: 1px solid var(--line, rgba(0, 0, 0, 0.06));
	}
	.cd-tbl {
		width: 100%;
		border-collapse: collapse;
		margin: 10px 0 12px;
		font-size: 13px;
	}
	.cd-tbl th,
	.cd-tbl td {
		text-align: left;
		padding: 8px 8px;
		border-bottom: 1px solid var(--line, rgba(0, 0, 0, 0.06));
		vertical-align: top;
	}
	.cd-tbl th {
		font-weight: 500;
		color: var(--ink-2, rgba(0, 0, 0, 0.55));
		font-size: 12px;
	}
	.cd-trunc {
		max-width: 260px;
		overflow-wrap: anywhere;
	}
	.cd-val {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		max-width: 360px;
		overflow-wrap: anywhere;
	}
	.cd-val code {
		flex: 1;
		font-size: 12px;
	}
	.cd-opt {
		margin-left: 6px;
		font-size: 11px;
		color: var(--ink-2, rgba(0, 0, 0, 0.5));
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.cd-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		align-items: center;
	}
	.cd-steps {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 12px;
	}
	.cd-step {
		font-size: 12px;
		padding: 3px 9px;
		border: 1px solid var(--border-strong, rgba(0, 0, 0, 0.12));
		border-radius: 999px;
		color: var(--ink-2, rgba(0, 0, 0, 0.6));
		text-decoration: none;
	}
	.cd-step.done {
		border-color: transparent;
		background: var(--success-100, rgba(60, 140, 90, 0.1));
		color: var(--success-700, #2f6b46);
	}
	.cd-add {
		display: flex;
		justify-content: flex-start;
		padding: 12px 14px 0;
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
