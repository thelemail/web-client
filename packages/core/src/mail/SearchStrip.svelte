<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import {
		faArrowUp,
		faChevronDown,
		faMagnifyingGlass,
		faShieldCheck,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import { Button } from '$core/components/ui/button';
	import { canFinishSearchSetup, finishSearchSetup } from '$core/search/finish-setup';
	import type { DimensionCoverage, Gap } from '$core/search/coverage';
	import type { Sort } from '$core/search/sqlite/compile';
	import { formatWhenLong } from './data';
	import type { SearchView } from './searchView';

	interface Props {
		search: SearchView;
	}

	let { search }: Props = $props();

	const uid = $props.id();
	const fmt = (n: number) => new Intl.NumberFormat().format(n);
	const SORTS: { id: Sort; label: () => string }[] = [
		{ id: 'relevance', label: msg.mail_search_sort_relevance },
		{ id: 'newest', label: msg.mail_search_sort_newest },
		{ id: 'oldest', label: msg.mail_search_sort_oldest }
	];
	const DIMENSION_LABEL: Record<number, () => string> = {
		1: msg.mail_search_dim_metadata,
		2: msg.mail_search_dim_body,
		3: msg.mail_search_dim_attachment_names,
		4: msg.mail_search_dim_attachment_text
	};
	const GAP_LABEL: Record<Gap, (p: { count: string }) => string> = {
		waiting: msg.mail_search_gap_waiting,
		locked: msg.mail_search_gap_locked,
		failed: msg.mail_search_gap_failed,
		tooLarge: msg.mail_search_gap_too_large,
		unsupported: msg.mail_search_gap_unsupported,
		password: msg.mail_search_gap_password,
		partial: msg.mail_search_gap_partial,
		timeout: msg.mail_search_gap_timeout
	};

	let details = $state(false);

	const status = $derived.by(() => {
		if (search.mode === 'desktop') return msg.mail_list_search_all();
		if (search.phase === 'locked') return msg.mail_search_locked();
		if (search.phase === 'unconverted') return msg.mail_search_unconverted();
		if (search.phase === 'unavailable') return msg.mail_search_unavailable();
		if (search.phase === 'failed') return search.error ? msg.mail_search_query_invalid() : msg.mail_search_failed();
		if (search.phase === 'starting') return msg.mail_search_starting();
		if (search.phase === 'searching') return search.matches !== null ? msg.mail_search_counting({ shown: fmt(search.groups ?? 0) }) : msg.mail_list_searching();
		if (search.groups !== null) return msg.mail_search_count({ count: search.groups, shown: fmt(search.groups) });
		return msg.mail_list_searching();
	});

	const shown = $derived(
		(search.coverage?.dimensions ?? []).filter((d) => DIMENSION_LABEL[d.dimension] && (search.mode === 'saved' || d.dimension === 1))
	);
	const worst = $derived.by<DimensionCoverage | null>(() => {
		let pick: DimensionCoverage | null = null;
		for (const d of shown) {
			const missing = d.total - d.done - d.excluded;
			if (missing > 0 && (!pick || missing > pick.total - pick.done - pick.excluded)) pick = d;
		}
		return pick;
	});
	const coverageLine = $derived.by(() => {
		const c = search.coverage;
		if (!c || search.mode !== 'saved') return null;
		if (search.limited === 'quota') return msg.mail_search_quota();
		if (!c.inventoryDone) return msg.mail_search_inventory();
		if (worst) return msg.mail_search_coverage({ what: DIMENSION_LABEL[worst.dimension](), done: fmt(worst.done), total: fmt(worst.total) });
		if (c.waitingOn && c.syncedAt) return msg.mail_search_synced_through({ when: formatWhenLong(new Date(c.syncedAt)) });
		return null;
	});
	const gaps = (d: DimensionCoverage) => (Object.entries(d.gaps) as [Gap, number][]).filter(([, n]) => n > 0);
	const announce = $derived(search.phase === 'ready' && search.groups !== null ? status : '');
</script>

<div class="srch-strip">
	<div class="ss-row">
		<Icon icon={faMagnifyingGlass} size={14} aria-hidden="true" />
		<span class="ss-status">{status}</span>
		{#if search.phase === 'unconverted' && canFinishSearchSetup()}
			<button type="button" class="ss-link" onclick={finishSearchSetup}>{msg.mail_search_unconverted_action()}</button>
		{/if}
		{#if search.mode === 'preview'}
			<span class="ss-mode">{msg.mail_search_preview_only()}</span>
			{#if search.canEnable && search.consent !== null}
				<button type="button" class="ss-link" onclick={search.onEnable}>{msg.mail_search_turn_on()}</button>
			{/if}
		{/if}
		{#if search.mode !== 'desktop'}
			<div class="ss-sort" role="group" aria-label={msg.mail_search_sort_label()}>
				{#each SORTS as s (s.id)}
					<button type="button" class:on={search.sort === s.id} aria-pressed={search.sort === s.id} onclick={() => search.onSort(s.id)}>{s.label()}</button>
				{/each}
			</div>
		{/if}
	</div>
	{#if search.chips.length}
		<div class="ss-row ss-chips">
			{#each search.chips as chip (chip.key)}
				<span class="srch-chip" class:neg={chip.negated}>
					<span dir="auto">{chip.text}</span>
					{#if chip.kind === 'label' && chip.matches > 1}
						<span class="ss-note">{msg.mail_search_label_many({ count: chip.matches, shown: fmt(chip.matches) })}</span>
					{/if}
					<button type="button" class="ss-x" aria-label={msg.mail_search_chip_remove({ chip: chip.text })} title={msg.mail_search_chip_remove({ chip: chip.text })} onclick={() => search.onRemoveChip(chip)}>
						<Icon icon={faXmark} size={11} />
					</button>
				</span>
				{#if chip.kind === 'folder' && chip.descendants > 0 && !chip.negated}
					<label class="ss-exact">
						<input type="checkbox" checked={search.exactFolders} onchange={(e) => search.onExactFolders(e.currentTarget.checked)} />
						{msg.mail_search_exact_folder()}
					</label>
				{/if}
			{/each}
		</div>
	{/if}
	{#if search.suggestions.length}
		<div class="ss-row ss-suggest">
			<span>{msg.mail_search_did_you_mean()}</span>
			{#each search.suggestions as s (`${s.range.start}:${s.replacement}`)}
				<button type="button" class="ss-link" onclick={() => search.onSuggestion(s)} dir="auto">{s.replacement}</button>
			{/each}
		</div>
	{/if}
	{#if coverageLine || search.paused}
		<div class="ss-row ss-cover">
			<Icon icon={faShieldCheck} size={13} aria-hidden="true" />
			<span>{coverageLine ?? msg.mail_search_paused()}</span>
			{#if coverageLine && search.paused}<span class="ss-note">{msg.mail_search_paused()}</span>{/if}
			{#if shown.length}
				<button type="button" class="ss-link" aria-expanded={details} aria-controls="{uid}-cov" onclick={() => (details = !details)}>
					{msg.mail_search_coverage_details()}<Icon icon={faChevronDown} size={12} class={details ? 'flip' : ''} />
				</button>
			{/if}
		</div>
		{#if details}
			<ul class="ss-cov" id="{uid}-cov">
				{#each shown as d (d.dimension)}
					<li>
						<span class="ss-dim">{msg.mail_search_coverage({ what: DIMENSION_LABEL[d.dimension](), done: fmt(d.done), total: fmt(d.total) })}</span>
						{#each gaps(d) as [gap, n] (gap)}
							<span class="ss-gap">{GAP_LABEL[gap]({ count: fmt(n) })}</span>
						{/each}
					</li>
				{/each}
				<li><a href={search.settingsHref}>{msg.mail_search_open_settings()}</a></li>
			</ul>
		{/if}
	{:else if search.limited === 'session' && search.mode === 'saved'}
		<div class="ss-row ss-cover"><span>{msg.mail_search_session()}</span></div>
	{/if}
	{#if search.newAvailable}
		<button type="button" class="new-strip ss-new" onclick={search.onRefresh}>
			<Icon icon={faArrowUp} size={14} />
			<span>{msg.mail_search_new_mail()}</span>
		</button>
	{/if}
	{#if search.mode === 'preview' && search.consent === null && search.canEnable}
		<section class="ss-setup" aria-labelledby="{uid}-setup">
			<h2 id="{uid}-setup">{msg.mail_search_setup_title()}</h2>
			<p>{msg.mail_search_setup_body()}</p>
			<div class="ss-actions">
				<Button size="sm" variant="primary" onclick={search.onEnable}>{msg.mail_search_setup_enable()}</Button>
				<Button size="sm" variant="ghost" onclick={search.onDecline}>{msg.mail_search_setup_later()}</Button>
			</div>
		</section>
	{/if}
	<span class="sr-only" role="status" aria-live="polite">{announce}</span>
</div>
