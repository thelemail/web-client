<script lang="ts">
	import { onMount } from 'svelte';
	import SecHead from '../SecHead.svelte';
	import Row from '../Row.svelte';
	import Card from '../Card.svelte';
	import Toggle from '../Toggle.svelte';
	import { Button } from '$core/components/ui/button';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { searchRuntime } from '$core/search/lazy';
	import { coverageOf, SHOWN_DIMENSIONS, type Gap } from '$core/search/coverage';
	import type { SearchPrefs } from '$core/search/runtime/records';
	import { Dimension } from '$core/search/sqlite/types';
	import { mailSearch } from '$core/stores/search.svelte';
	import { formatWhenLong } from '$core/mail/data';
	import { m } from '$paraglide/messages.js';

	let prefs = $state.raw<SearchPrefs | null>(null);
	let confirm = $state<'clear' | 'rebuild' | null>(null);
	let busy = $state(false);
	let failed = $state<string | null>(null);
	let retried = $state(false);

	onMount(() =>
		searchRuntime.subscribePrefs((p) => {
			prefs = p;
			if (p?.consent === 'saved') mailSearch.warm();
		})
	);

	const fmt = (n: number) => new Intl.NumberFormat().format(n);
	const available = $derived(mailSearch.fullSearch);
	const saved = $derived(prefs?.consent === 'saved' && available);
	const status = $derived(mailSearch.client?.status ?? null);
	const phase = $derived(mailSearch.client?.phase ?? null);
	const coverage = $derived(coverageOf(status, SHOWN_DIMENSIONS));
	const DIMENSION_LABEL: Record<number, () => string> = {
		[Dimension.metadata]: m.mail_search_dim_metadata,
		[Dimension.body]: m.mail_search_dim_body,
		[Dimension.attachmentMetadata]: m.mail_search_dim_attachment_names,
		[Dimension.attachmentText]: m.mail_search_dim_attachment_text
	};
	const GAP_LABEL: Record<Gap, (p: { count: string }) => string> = {
		waiting: m.mail_search_gap_waiting,
		locked: m.mail_search_gap_locked,
		failed: m.mail_search_gap_failed,
		tooLarge: m.mail_search_gap_too_large,
		unsupported: m.mail_search_gap_unsupported,
		password: m.mail_search_gap_password,
		partial: m.mail_search_gap_partial,
		timeout: m.mail_search_gap_timeout
	};
	const failures = $derived(
		coverage.dimensions.reduce((n, d) => n + (d.gaps.failed ?? 0) + (d.gaps.tooLarge ?? 0) + (d.gaps.locked ?? 0), 0)
	);
	const statusLine = $derived.by(() => {
		if (!saved) return m.settings_search_off_status();
		if (phase === 'locked') return m.mail_search_locked_detail();
		if (phase === 'failed') return m.mail_search_unavailable_detail();
		if (!status) return m.mail_search_starting();
		if (status.limited === 'quota') return m.mail_search_quota();
		if (status.limited === 'session') return m.mail_search_session();
		if (!coverage.inventoryDone) return m.mail_search_inventory();
		if (coverage.complete) return m.settings_search_complete();
		return status.paused ? m.mail_search_paused() : m.settings_search_working();
	});

	async function run(work: () => Promise<void>) {
		busy = true;
		failed = null;
		try {
			await work();
		} catch {
			failed = m.settings_search_action_failed();
		} finally {
			busy = false;
		}
	}

	function toggleIndex(on: boolean) {
		if (on) void run(() => searchRuntime.enable());
		else confirm = 'clear';
	}

	async function confirmed() {
		const which = confirm;
		await run(async () => {
			if (which === 'clear') await searchRuntime.clear();
			else if (which === 'rebuild') await searchRuntime.rebuild();
			mailSearch.refresh();
		});
		confirm = null;
	}
</script>

<SecHead desc={m.settings_search_desc()} />

<Card title={m.settings_search_device_title()}>
	<Row
		t={m.settings_search_index()}
		d={!available ? m.settings_search_index_unavailable_desc() : saved ? m.settings_search_index_on_desc() : m.settings_search_index_off_desc()}
	>
		<Toggle on={saved} disabled={busy || prefs === null || !available} onChange={toggleIndex} />
	</Row>
	<div class="setrow col" role="status" aria-live="polite">
		<div class="info">
			<div class="t">{statusLine}</div>
			{#if saved && status}
				<ul class="srch-cov-list">
					{#each coverage.dimensions.filter((d) => DIMENSION_LABEL[d.dimension]) as d (d.dimension)}
						<li>
							<span>{m.mail_search_coverage({ what: DIMENSION_LABEL[d.dimension](), done: fmt(d.done), total: fmt(d.total) })}</span>
							{#each Object.entries(d.gaps) as [gap, n] (gap)}
								{#if n}<span class="d">{GAP_LABEL[gap as Gap]({ count: fmt(n) })}</span>{/if}
							{/each}
						</li>
					{/each}
					{#if coverage.syncedAt}
						<li class="d">{m.mail_search_synced_through({ when: formatWhenLong(new Date(coverage.syncedAt)) })}</li>
					{/if}
				</ul>
			{/if}
		</div>
	</div>
	{#if saved}
		<Row t={m.settings_search_pause()} d={m.settings_search_pause_desc()}>
			<Toggle on={prefs?.paused ?? false} disabled={busy} onChange={(v) => void run(() => searchRuntime.setPaused(v))} />
		</Row>
		<Row t={m.settings_search_retry()} d={retried ? m.settings_search_retry_started() : m.settings_search_retry_desc({ count: fmt(failures) })}>
			<Button
				size="sm"
				disabled={busy || failures === 0 || phase !== 'ready'}
				onclick={() =>
					void run(async () => {
						await searchRuntime.retryFailed();
						retried = true;
					})}>{m.settings_search_retry_action()}</Button
			>
		</Row>
		<Row t={m.settings_search_rebuild()} d={m.settings_search_rebuild_desc()}>
			<Button size="sm" disabled={busy} onclick={() => (confirm = 'rebuild')}>{m.settings_search_rebuild_action()}</Button>
		</Row>
		<Row t={m.settings_search_clear()} d={m.settings_search_clear_desc()}>
			<Button size="sm" variant="danger" disabled={busy} onclick={() => (confirm = 'clear')}>{m.settings_search_clear_action()}</Button>
		</Row>
	{/if}
	{#if failed}
		<p class="srch-err" role="alert">{failed}</p>
	{/if}
</Card>

{#if saved}
	<Card title={m.settings_search_history_title()}>
		<Row t={m.settings_search_history()} d={m.settings_search_history_desc()}>
			<Toggle on={prefs?.history ?? false} disabled={busy} onChange={(v) => void run(() => searchRuntime.setHistory(v))} />
		</Row>
	</Card>
{/if}

{#if confirm}
	<ConfirmDialog
		title={confirm === 'clear' ? m.settings_search_clear_confirm_title() : m.settings_search_rebuild_confirm_title()}
		sub={confirm === 'clear' ? m.settings_search_clear_confirm_body() : m.settings_search_rebuild_confirm_body()}
		tone={confirm === 'clear' ? 'danger' : 'neutral'}
		confirmLabel={confirm === 'clear' ? m.settings_search_clear_action() : m.settings_search_rebuild_action()}
		{busy}
		onConfirm={confirmed}
		onClose={() => (confirm = null)}
	/>
{/if}
