<script lang="ts">
	import { onMount } from 'svelte';
	import Clock from '@lucide/svelte/icons/clock';
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import SystemAlerts from './SystemAlerts.svelte';
	import LifecycleBanners from '$lib/lifecycle/LifecycleBanners.svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';
	import Avatar from './Avatar.svelte';
	import Menu from '@lucide/svelte/icons/menu';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { mailNav } from '$lib/stores/nav.svelte';
	import Compose from './Compose.svelte';
	import { mailSearch } from '$lib/stores/mailSearch.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import Toast from './Toast.svelte';
	import { scheduled, type ScheduledRow } from '$lib/stores/scheduled.svelte';
	import { composeStore } from '$lib/stores/compose.svelte';
	import { drafts } from '$lib/stores/drafts.svelte';
	import { mailbox } from '$lib/stores/mailbox.svelte';
	import { DEFAULT_QUERY } from './url';
	import { auth } from '$lib/stores/auth.svelte';
	import { formatWhenLong } from './data';

	onMount(() => mailSearch.clear());

	let toast = $state<{ text: string } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingCancel = $state<ScheduledRow | null>(null);
	let cancelling = $state(false);
	let cancelError = $state<string | null>(null);

	const now = new Date();

	function flash(text: string) {
		toast = { text };
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 2600);
	}

	$effect(() => {
		if (auth.canEnterApp) void scheduled.ensureLoaded();
	});

	const list = $derived(
		scheduled.items.filter((r) => {
			const q = mailSearch.text.trim().toLowerCase();
			if (!q) return true;
			return [r.subject, r.snippet, r.to].some((v) => v.toLowerCase().includes(q));
		})
	);

	async function confirmCancel() {
		const row = pendingCancel;
		if (!row) return;
		cancelling = true;
		cancelError = null;
		try {
			await scheduled.cancel(row.id);
			pendingCancel = null;
			flash('Scheduled send cancelled');
			void mailbox.refresh([{ ...DEFAULT_QUERY, folder: 'sent' }]);
		} catch (e) {
			cancelError = e instanceof Error ? e.message : 'Could not cancel this send.';
		} finally {
			cancelling = false;
		}
	}

	function onSend(info?: { scheduledAt?: string }) {
		composeStore.close();
		flash(
			info?.scheduledAt
				? `Send scheduled for ${formatWhenLong(new Date(info.scheduledAt))}`
				: 'Message sent'
		);
		void drafts.refresh();
		void scheduled.refresh();
		void mailbox.refresh([
			{ ...DEFAULT_QUERY, folder: 'inbox' },
			{ ...DEFAULT_QUERY, folder: 'sent' }
		]);
	}
</script>

<svelte:head>
	<title>Thelemail — Scheduled</title>
</svelte:head>

<LifecycleBanners />
<SystemAlerts />

<div class="mailbody">
	<section class="list">
		<div class="list-h">
			<button class="lh-nav" title="Menu" onclick={() => (mailNav.open = !mailNav.open)}>
				<Menu size={18} />
			</button>
			<div class="ttl-block">
				<span class="ttl">Scheduled<span class="n">{scheduled.items.length}</span></span>
			</div>
			<div class="grow"></div>
			<button class="lh-btn" title="Refresh" onclick={() => scheduled.refresh()}>
				<RefreshCw size={16} />
			</button>
		</div>
		<div class="scroll">
			{#if scheduled.loading && list.length === 0}
				<div class="sch-empty"><div class="t">Loading…</div></div>
			{:else if scheduled.loadError && list.length === 0}
				<div class="sch-empty">
					<div class="t">Could not load scheduled sends</div>
					<div class="d">{scheduled.loadError}</div>
					<button class="sch-retry" onclick={() => scheduled.refresh()}>Retry</button>
				</div>
			{:else if list.length === 0}
				<div class="sch-empty">
					<div class="ring"><Clock size={28} /></div>
					<div class="t">{mailSearch.text.trim() ? 'No matches' : 'Nothing scheduled'}</div>
					<div class="d">
						{mailSearch.text.trim()
							? 'No scheduled sends match your search.'
							: 'Messages you schedule from the compose window wait here until they go out.'}
					</div>
				</div>
			{:else}
				{#each list as r (r.id)}
					<div class="sch-row">
						<Avatar initials={r.init || 'S'} size={34} bg="var(--pine-100)" fg="var(--pine-700)" />
						<div class="sch-main">
							<div class="sch-top">
								<span class="sch-to">{r.to || '(no recipients)'}</span>
								<span class="sch-time">{formatWhenLong(new Date(r.scheduledAt), now)}</span>
							</div>
							<div class="sch-subj">
								<span class="sch-tag">{r.kind === 'external' ? 'External' : 'Thelemail'}</span>
								{r.subject}
							</div>
							<div class="sch-prev">{r.snippet || 'No preview'}</div>
						</div>
						<button
							type="button"
							class="sch-cancel"
							disabled={lifecycle.readOnly}
							onclick={() => {
								cancelError = null;
								pendingCancel = r;
							}}
						>
							Cancel
						</button>
					</div>
				{/each}
				{#if !scheduled.exhausted}
					<div class="sch-more">
						<button onclick={() => scheduled.loadMore()} disabled={scheduled.loadingMore}>
							{scheduled.loadingMore ? 'Loading…' : 'Load more'}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</section>
	<div class="sch-side">
		<div class="sch-side-in">
			<SendHorizontal size={40} />
			<p>Scheduled messages stay encrypted until they go out.</p>
		</div>
	</div>
</div>

{#snippet cancelBody()}
	<p class="cfd-p">
		The message will not be delivered and nothing is kept. Write it again when you're ready.
	</p>
{/snippet}

{#if pendingCancel}
	<ConfirmDialog
		icon={Clock}
		title="Cancel this scheduled send?"
		sub={pendingCancel.subject}
		tone="danger"
		confirmLabel="Cancel send"
		cancelLabel="Keep it scheduled"
		busy={cancelling}
		error={cancelError}
		body={cancelBody}
		onConfirm={confirmCancel}
		onClose={() => {
			if (!cancelling) pendingCancel = null;
		}}
	/>
{/if}

{#if !composeStore.open}
	<button class="fab" title="Compose" onclick={() => composeStore.openNew()}>
		<PenLine size={22} />
	</button>
{/if}
{#if composeStore.open}
	{#key composeStore.editingDraftId}
		<Compose draftId={composeStore.editingDraftId} onClose={() => composeStore.close()} {onSend} />
	{/key}
{/if}
{#if toast}
	<Toast text={toast.text} />
{/if}

<style>
	.sch-row {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--surface);
	}
	.sch-row:hover {
		background: var(--paper-100);
	}
	.sch-main {
		flex: 1;
		min-width: 0;
	}
	.sch-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.sch-to {
		font-weight: 600;
		font-size: 13.5px;
		color: var(--fg-strong);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sch-time {
		flex: 0 0 auto;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--brass-600);
	}
	.sch-subj {
		font-size: 13px;
		color: var(--fg-strong);
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sch-tag {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--pine-700);
		margin-right: 4px;
	}
	.sch-prev {
		font-size: 12.5px;
		color: var(--ink-500);
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sch-cancel {
		flex: 0 0 auto;
		font-family: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink-600);
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-sm);
		padding: 5px 11px;
		cursor: pointer;
	}
	.sch-cancel:hover {
		background: var(--danger-100);
		border-color: var(--danger-500);
		color: var(--danger-700);
	}
	.sch-cancel:disabled {
		opacity: 0.5;
		pointer-events: none;
	}
	.sch-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 56px 24px;
		gap: 6px;
		color: var(--ink-500);
	}
	.sch-empty .ring {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--paper-100);
		color: var(--brass-600);
		margin-bottom: 8px;
	}
	.sch-empty .t {
		font-family: var(--font-sans);
		font-feature-settings: normal;
		font-size: 17px;
		color: var(--fg-strong);
	}
	.sch-empty .d {
		font-size: 13px;
		color: var(--ink-400);
		max-width: 300px;
	}
	.sch-retry {
		margin-top: 10px;
	}
	.sch-more {
		display: flex;
		justify-content: center;
		padding: 14px;
	}
	.sch-more button {
		font-size: 12.5px;
		color: var(--pine-700);
		background: none;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 14px;
		cursor: pointer;
	}
	.sch-side {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--paper-50);
	}
	.sch-side-in {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		color: var(--ink-400);
		text-align: center;
	}
	.sch-side-in p {
		font-size: 13px;
		max-width: 240px;
	}
</style>
