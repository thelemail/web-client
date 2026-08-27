<script lang="ts">
	import FileText from '@lucide/svelte/icons/file-text';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import { onMount } from 'svelte';
	import SystemAlerts from './SystemAlerts.svelte';
	import LifecycleBanners from '$lib/lifecycle/LifecycleBanners.svelte';
	import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';
	import Avatar from './Avatar.svelte';
	import Menu from '@lucide/svelte/icons/menu';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { mailNav } from '$lib/stores/nav.svelte';
	import Compose from './Compose.svelte';
	import { mailSearch } from '$lib/stores/mailSearch.svelte';
	import Toast from './Toast.svelte';
	import { drafts, type DraftRow } from '$lib/stores/drafts.svelte';
	import { scheduled } from '$lib/stores/scheduled.svelte';
	import { composeStore } from '$lib/stores/compose.svelte';
	import { deleteDraft } from '$lib/api/drafts';
	import { mailbox } from '$lib/stores/mailbox.svelte';
	import { DEFAULT_QUERY } from './url';
	import { auth } from '$lib/stores/auth.svelte';
	import { formatRowTime, formatWhenLong } from './data';

	onMount(() => mailSearch.clear());

	let toast = $state<{ text: string } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;


	function flash(text: string) {
		toast = { text };
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 2600);
	}

	$effect(() => {
		if (auth.canEnterApp) void drafts.ensureLoaded();
	});

	const list = $derived(
		drafts.items.filter((d) => {
			const q = mailSearch.text.trim().toLowerCase();
			if (!q) return true;
			return [d.subject, d.snippet, d.to].some((v) => v.toLowerCase().includes(q));
		})
	);

	function openDraft(d: DraftRow) {
		if (lifecycle.readOnly) return;
		composeStore.openDraft(d.id);
	}

	async function discardRow(e: MouseEvent, d: DraftRow) {
		e.stopPropagation();
		if (lifecycle.readOnly) return;
		drafts.remove(d.id);
		if (composeStore.editingDraftId === d.id) composeStore.close();
		try {
			await deleteDraft(d.id);
			flash('Draft discarded');
		} catch {
			flash('Could not discard draft');
			void drafts.refresh();
		}
	}

	function onSend(info?: { scheduledAt?: string }) {
		composeStore.close();
		if (info?.scheduledAt) {
			flash(`Send scheduled for ${formatWhenLong(new Date(info.scheduledAt))}`);
			void scheduled.refresh();
		} else {
			flash('Message sent');
		}
		void drafts.refresh();
		void mailbox.refresh([
			{ ...DEFAULT_QUERY, folder: 'inbox' },
			{ ...DEFAULT_QUERY, folder: 'sent' }
		]);
	}
</script>

<svelte:head>
	<title>Thelemail — Drafts</title>
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
				<span class="ttl">Drafts<span class="n">{drafts.items.length}</span></span>
			</div>
			<div class="grow"></div>
			<button class="lh-btn" title="Refresh" onclick={() => drafts.refresh()}>
				<RefreshCw size={16} />
			</button>
		</div>
		<div class="scroll">
			{#if drafts.loading && list.length === 0}
				<div class="drafts-empty"><div class="t">Loading…</div></div>
			{:else if drafts.loadError && list.length === 0}
				<div class="drafts-empty">
					<div class="t">Could not load drafts</div>
					<div class="d">{drafts.loadError}</div>
					<button class="dretry" onclick={() => drafts.refresh()}>Retry</button>
				</div>
			{:else if list.length === 0}
				<div class="drafts-empty">
					<div class="ring"><FileText size={28} /></div>
					<div class="t">{mailSearch.text.trim() ? 'No matches' : 'No drafts'}</div>
					<div class="d">
						{mailSearch.text.trim()
							? 'No drafts match your search.'
							: 'Messages you start but don’t send are saved here.'}
					</div>
				</div>
			{:else}
				{#each list as d (d.id)}
					<div
						class="drow"
						class:active={composeStore.editingDraftId === d.id}
						role="button"
						tabindex="0"
						onclick={() => openDraft(d)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								openDraft(d);
							}
						}}
					>
						<Avatar initials={d.init || 'D'} size={34} bg="var(--brass-100)" fg="var(--brass-700)" />
						<div class="dmain">
							<div class="dtop">
								<span class="dto">{d.to || '(no recipients)'}</span>
								<span class="dtime">{formatRowTime(new Date(d.epoch))}</span>
							</div>
							<div class="dsubj">
								<span class="draft-tag">Draft</span>
								{d.subject}
							</div>
							<div class="dprev">{d.snippet || 'No content yet'}</div>
						</div>
						<div class="dmeta">
							{#if d.attachmentCount > 0}
								<span class="datt"><Paperclip size={14} />{d.attachmentCount}</span>
							{/if}
							<button
								type="button"
								class="ddel"
								title="Discard draft"
								onclick={(e) => discardRow(e, d)}
							>
								<Trash2 size={16} />
							</button>
						</div>
					</div>
				{/each}
				{#if !drafts.exhausted}
					<div class="dmore">
						<button onclick={() => drafts.loadMore()} disabled={drafts.loadingMore}>
							{drafts.loadingMore ? 'Loading…' : 'Load more'}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</section>
	<div class="drafts-side">
		<div class="ds-inner">
			<FileText size={40} />
			<p>Select a draft to continue editing.</p>
		</div>
	</div>
</div>

{#if !composeStore.open}
	<button class="fab" title="Compose" onclick={() => composeStore.openNew()}>
		<PenLine size={22} />
	</button>
{/if}
{#if composeStore.open}
	{#key composeStore.editingDraftId}
		<Compose
			draftId={composeStore.editingDraftId}
			onClose={() => composeStore.close()}
			{onSend}
		/>
	{/key}
{/if}
{#if toast}
	<Toast text={toast.text} />
{/if}

<style>
	.drow {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		cursor: pointer;
		background: var(--surface);
	}
	.drow:hover {
		background: var(--paper-100);
	}
	.drow.active {
		background: var(--paper-200);
	}
	.dmain {
		flex: 1;
		min-width: 0;
	}
	.dtop {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.dto {
		font-weight: 600;
		font-size: 13.5px;
		color: var(--fg-strong);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dtime {
		flex: 0 0 auto;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-400);
	}
	.dsubj {
		font-size: 13px;
		color: var(--fg-strong);
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.draft-tag {
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--danger-700);
		margin-right: 4px;
	}
	.dprev {
		font-size: 12.5px;
		color: var(--ink-500);
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.dmeta {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 0 0 auto;
	}
	.datt {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--ink-400);
	}
	.ddel {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: none;
		border-radius: 8px;
		color: var(--ink-400);
		cursor: pointer;
		opacity: 0;
	}
	.drow:hover .ddel {
		opacity: 1;
	}
	.ddel:hover {
		background: var(--danger-100);
		color: var(--danger-700);
	}
	.drafts-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 56px 24px;
		gap: 6px;
		color: var(--ink-500);
	}
	.drafts-empty .ring {
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
	.drafts-empty .t {
		font-family: var(--font-sans); font-feature-settings: normal;
		font-size: 17px;
		color: var(--fg-strong);
	}
	.drafts-empty .d {
		font-size: 13px;
		color: var(--ink-400);
		max-width: 280px;
	}
	.dretry,
	.drafts-empty .dretry {
		margin-top: 10px;
	}
	.dmore {
		display: flex;
		justify-content: center;
		padding: 14px;
	}
	.dmore button {
		font-size: 12.5px;
		color: var(--pine-700);
		background: none;
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 6px 14px;
		cursor: pointer;
	}
	.drafts-side {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--paper-50);
	}
	.ds-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		color: var(--ink-400);
		text-align: center;
	}
	.ds-inner p {
		font-size: 13px;
	}
</style>
