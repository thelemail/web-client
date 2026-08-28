<script lang="ts">
	import Globe2 from '@lucide/svelte/icons/globe-2';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { SvelteSet } from 'svelte/reactivity';

	import Card from '$lib/settings/Card.svelte';
	import Badge from '$lib/settings/Badge.svelte';
	import CopyBtn from '$lib/settings/CopyBtn.svelte';
	import DnsChip from '$lib/settings/DnsChip.svelte';
	import AddRow from '$lib/settings/AddRow.svelte';
	import SecHead from '$lib/settings/SecHead.svelte';
	import type { CeremonyKind } from '$lib/settings/data';
	import {
		customDomains as store
	} from '$lib/stores/customDomains.svelte';
	import { workspaces } from '$lib/stores/workspaces.svelte';
	import type {
		CustomDomain,
		CustomDomainStatus,
		DNSRecordStatus
	} from '$lib/api/customDomains';

	interface Props {
		launch: (k: CeremonyKind) => void;
	}

	let { launch }: Props = $props();

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

	function statusKind(s: CustomDomainStatus): 'ok' | 'warn' | 'info' | 'neutral' {
		switch (s) {
			case 'verified':
				return 'ok';
			case 'pending':
				return 'info';
			case 'failed':
				return 'warn';
			default:
				return 'neutral';
		}
	}

	function statusLabel(s: CustomDomainStatus): string {
		return s.charAt(0).toUpperCase() + s.slice(1);
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
							<div class="cd-actions">
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

	<AddRow label="Add a domain" onClick={() => launch('domain')} />

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
		grid-template-columns: 18px 1fr auto auto;
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
