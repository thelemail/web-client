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
	import { canFinishSearchSetup, finishSearchSetup } from '$core/custody/search-setup';
	import { formatWhenLong } from '$core/mail/data';
	import { m } from '$paraglide/messages.js';
	import { MODEL_DOWNLOAD_BYTES } from '$core/search/model/download';

	let prefs = $state.raw<SearchPrefs | null>(null);
	let confirm = $state<'clear' | 'rebuild' | 'cloud' | 'meaning' | null>(null);
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
		[Dimension.attachmentText]: m.mail_search_dim_attachment_text,
		[Dimension.semantic]: m.mail_search_dim_meaning
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
		if (phase === 'unconverted') return m.mail_search_unconverted_detail();
		if (phase === 'failed') return m.mail_search_unavailable_detail();
		if (!status) return m.mail_search_starting();
		if (status.limited === 'quota') return m.mail_search_quota();
		if (status.limited === 'session') return m.mail_search_session();
		if (!coverage.inventoryDone) return m.mail_search_inventory();
		if (coverage.complete) return m.settings_search_complete();
		return status.paused ? m.mail_search_paused() : m.settings_search_working();
	});

	const cloud = $derived(status?.cloud ?? null);
	const artifacts = $derived(status?.artifacts ?? null);
	const CLOUD_LINE: Record<string, () => string> = {
		locked: m.settings_search_cloud_locked,
		unavailable: m.settings_search_cloud_unavailable,
		stale: m.settings_search_cloud_stale,
		error: m.settings_search_cloud_error
	};
	const cloudLine = $derived.by(() => {
		if (phase !== 'ready' || cloud === null) return m.settings_search_cloud_checking();
		if (cloud === 'off') return null;
		if (cloud !== 'on') return CLOUD_LINE[cloud]();
		if (artifacts?.full) return m.settings_search_cloud_full();
		if (artifacts?.state !== 'ready') return m.settings_search_cloud_listing();
		return m.settings_search_cloud_ready();
	});

	const mb = (bytes: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(bytes / 1_000_000);
	const meaning = $derived(prefs?.semantic ?? false);
	const engine = $derived(status?.semantic ?? null);
	const meaningLine = $derived.by(() => {
		if (!meaning || phase !== 'ready' || !engine) return null;
		switch (engine.state) {
			case 'downloading':
				return m.settings_search_meaning_downloading({ done: mb(engine.loaded), total: mb(engine.total) });
			case 'loading':
				return m.settings_search_meaning_loading();
			case 'waiting':
				return m.settings_search_meaning_waiting();
			case 'unavailable':
				if (engine.reason === 'assets') return m.settings_search_meaning_download_failed();
				if (engine.reason === 'memory') return m.settings_search_meaning_no_memory();
				return m.settings_search_meaning_unsupported();
			default:
				return null;
		}
	});

	function toggleMeaning(on: boolean) {
		if (on) confirm = 'meaning';
		else void run(() => searchRuntime.setSemantic(false));
	}

	function toggleCloud(on: boolean) {
		if (on) void run(() => searchRuntime.setCloudSync(true));
		else confirm = 'cloud';
	}

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

	const CONFIRM: Record<NonNullable<typeof confirm>, { title: () => string; sub: () => string; action: () => string }> = {
		clear: { title: m.settings_search_clear_confirm_title, sub: m.settings_search_clear_confirm_body, action: m.settings_search_clear_action },
		cloud: { title: m.settings_search_cloud_off_confirm_title, sub: m.settings_search_cloud_off_confirm_body, action: m.settings_search_cloud_off_action },
		rebuild: { title: m.settings_search_rebuild_confirm_title, sub: m.settings_search_rebuild_confirm_body, action: m.settings_search_rebuild_action },
		meaning: {
			title: m.settings_search_meaning_confirm_title,
			sub: () => m.settings_search_meaning_confirm_body({ size: mb(MODEL_DOWNLOAD_BYTES) }),
			action: m.settings_search_meaning_confirm_action
		}
	};

	async function confirmed() {
		const which = confirm;
		await run(async () => {
			if (which === 'clear') await searchRuntime.clear();
			else if (which === 'rebuild') await searchRuntime.rebuild();
			else if (which === 'cloud') await searchRuntime.setCloudSync(false);
			else if (which === 'meaning') await searchRuntime.setSemantic(true);
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
			{#if phase === 'unconverted' && canFinishSearchSetup()}
				<Button variant="tonal" size="sm" onclick={finishSearchSetup}>{m.mail_search_unconverted_action()}</Button>
			{/if}
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
		<Row t={m.settings_search_meaning()} d={meaning ? m.settings_search_meaning_on_desc() : m.settings_search_meaning_off_desc()}>
			<Toggle on={meaning} disabled={busy || prefs === null} onChange={toggleMeaning} />
		</Row>
		{#if meaningLine}
			<div class="setrow col" role="status" aria-live="polite">
				<div class="info">
					<div class="t">{meaningLine}</div>
				</div>
			</div>
		{/if}
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
	<Card title={m.settings_search_cloud_title()}>
		<Row t={m.settings_search_cloud()} d={cloud === 'off' ? m.settings_search_cloud_off_desc() : m.settings_search_cloud_on_desc()}>
			{#if cloud !== null && phase === 'ready'}
				<Toggle on={cloud !== 'off'} disabled={busy || cloud === 'unavailable'} onChange={toggleCloud} />
			{/if}
		</Row>
		{#if cloudLine}
			<div class="setrow col" role="status" aria-live="polite">
				<div class="info">
					<div class="t">{cloudLine}</div>
					{#if cloud === 'on' && artifacts}
						<ul class="srch-cov-list">
							{#if artifacts.hydrated}<li>{m.settings_search_cloud_hydrated({ count: fmt(artifacts.hydrated) })}</li>{/if}
							{#if artifacts.due}<li>{m.settings_search_cloud_due({ count: fmt(artifacts.due) })}</li>{/if}
							{#if artifacts.localOnly}<li class="d">{m.settings_search_cloud_local({ count: fmt(artifacts.localOnly) })}</li>{/if}
						</ul>
					{/if}
				</div>
			</div>
		{/if}
	</Card>

	<Card title={m.settings_search_history_title()}>
		<Row t={m.settings_search_history()} d={m.settings_search_history_desc()}>
			<Toggle on={prefs?.history ?? false} disabled={busy} onChange={(v) => void run(() => searchRuntime.setHistory(v))} />
		</Row>
	</Card>
{/if}

{#if confirm}
	<ConfirmDialog
		title={CONFIRM[confirm].title()}
		sub={CONFIRM[confirm].sub()}
		tone={confirm === 'rebuild' || confirm === 'meaning' ? 'neutral' : 'danger'}
		confirmLabel={CONFIRM[confirm].action()}
		{busy}
		onConfirm={confirmed}
		onClose={() => (confirm = null)}
	/>
{/if}
