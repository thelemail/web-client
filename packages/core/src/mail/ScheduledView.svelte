<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { onMount } from 'svelte';
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import LoadState from '$core/components/LoadState.svelte';
	import { EmptyState } from '$core/components/ui/empty-state';
	import {
		faArrowsRotate,
		faCircleExclamation,
		faClock,
		faMagnifyingGlass,
		faPaperPlaneTop,
		faPenLine
	} from '@fortawesome/pro-regular-svg-icons';
	import SystemAlerts from './SystemAlerts.svelte';
	import LifecycleBanners from '$core/lifecycle/LifecycleBanners.svelte';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';
	import Avatar from '$core/components/Avatar.svelte';
	import { mailSearch } from '$core/stores/search.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import Toast from '$core/components/Toast.svelte';
	import { scheduled, type ScheduledRow } from '$core/stores/scheduled.svelte';
	import { composeStore } from '$core/stores/compose.svelte';
	import { mailbox } from '$core/stores/mailbox.svelte';
	import { DEFAULT_QUERY } from './url';
	import { auth } from '$core/stores/auth.svelte';
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
			flash(m.mail_scheduled_cancelled());
			void mailbox.refresh([{ ...DEFAULT_QUERY, folder: 'sent' }]);
		} catch (e) {
			cancelError = e instanceof Error ? e.message : m.mail_scheduled_cancel_failed();
		} finally {
			cancelling = false;
		}
	}
</script>

<svelte:head>
	<title>{m.mail_scheduled_page_title()}</title>
</svelte:head>

<LifecycleBanners />
<SystemAlerts />

<div class="mailbody">
	<section class="list">
		<div class="list-h">
			<h1 class="ttl">
				<span class="ttl-name">{m.mailbox_folder_scheduled()}</span>
				{#if scheduled.count > 0}
					<span class="ttl-ct">{scheduled.count}</span>
				{/if}
			</h1>
			<div class="lh-actions">
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					tooltip={m.mail_refresh()}
					onclick={() => scheduled.refresh()}
				>
					<Icon icon={faArrowsRotate} size={16} />
				</Button>
			</div>
		</div>
		<div class="scroll">
			{#if scheduled.loading && list.length === 0}
				<LoadState kind="loading" label={m.common_loading()} rows={4} />
			{:else if scheduled.loadError && list.length === 0}
				<EmptyState tone="error" icon={faCircleExclamation} title={m.mail_scheduled_load_failed()} description={scheduled.loadError}>
					{#snippet action()}
						<Button variant="neutral" size="sm" onclick={() => scheduled.refresh()}>{m.mail_retry()}</Button>
					{/snippet}
				</EmptyState>
			{:else if list.length === 0}
				<EmptyState
					icon={mailSearch.text.trim() ? faMagnifyingGlass : faClock}
					title={mailSearch.text.trim() ? m.mail_no_matches() : m.mail_scheduled_empty()}
					description={mailSearch.text.trim() ? m.mail_scheduled_no_matches() : m.mail_scheduled_empty_detail()}
				/>
			{:else}
				{#each list as r (r.id)}
					<div class="sch-row">
						<Avatar initials={r.init || 'S'} size={34} bg="var(--pine-100)" fg="var(--pine-700)" />
						<div class="sch-main">
							<div class="sch-top">
								<span class="sch-to">{r.to || m.mail_no_recipients()}</span>
								<span class="sch-time">{formatWhenLong(new Date(r.scheduledAt), now)}</span>
							</div>
							<div class="sch-subj">
								<span class="sch-tag">{r.kind === 'external' ? m.mail_scheduled_tag_external() : m.mail_scheduled_tag_internal()}</span>
								{r.subject}
							</div>
							<div class="sch-prev">{r.snippet || m.mail_scheduled_no_preview()}</div>
						</div>
						<Button
							variant="danger"
							size="sm"
							class="sch-cancel"
							disabled={lifecycle.readOnly}
							onclick={() => {
								cancelError = null;
								pendingCancel = r;
							}}
						>
							{m.common_cancel()}
						</Button>
					</div>
				{/each}
				{#if !scheduled.exhausted}
					<div class="sch-more">
						<Button
							variant="neutral"
							size="sm"
							busy={scheduled.loadingMore}
							busyLabel={m.common_loading()}
							onclick={() => scheduled.loadMore()}
						>
							{m.mail_load_more()}
						</Button>
					</div>
				{/if}
			{/if}
		</div>
	</section>
	<div class="sch-side">
		<div class="sch-side-in">
			<Icon icon={faPaperPlaneTop} size={40} />
			<p>{m.mail_scheduled_side()}</p>
		</div>
	</div>
</div>

{#snippet cancelBody()}
	<p class="dialog-p">{m.mail_scheduled_cancel_body()}</p>
{/snippet}

{#if pendingCancel}
	<ConfirmDialog
		icon={faClock}
		title={m.mail_scheduled_cancel_title()}
		sub={pendingCancel.subject}
		tone="danger"
		confirmLabel={m.mail_scheduled_cancel_confirm()}
		cancelLabel={m.mail_scheduled_cancel_keep()}
		busy={cancelling}
		error={cancelError}
		body={cancelBody}
		onConfirm={confirmCancel}
		onClose={() => {
			if (!cancelling) pendingCancel = null;
		}}
	/>
{/if}

{#if !composeStore.active}
	<button class="fab" title={m.mail_compose()} onclick={() => composeStore.openNew()}>
		<Icon icon={faPenLine} size={22} />
	</button>
{/if}
{#if toast}
	<Toast text={toast.text} shift={131} />
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
		background: var(--bg-sunken);
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
		color: var(--fg-muted);
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sch-row :global(.sch-cancel) {
		flex: 0 0 auto;
	}
	.sch-more {
		display: flex;
		justify-content: center;
		padding: 14px;
	}
	.sch-side {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--bg-raised);
	}
	.sch-side-in {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		color: var(--fg-faint);
		text-align: center;
	}
	.sch-side-in p {
		font-size: 13px;
		max-width: 240px;
	}
</style>
