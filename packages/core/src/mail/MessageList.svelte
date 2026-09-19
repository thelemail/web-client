<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import Check from '@lucide/svelte/icons/check';
	import MailOpen from '@lucide/svelte/icons/mail-open';
	import Archive from '@lucide/svelte/icons/archive';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import SquareCheck from '@lucide/svelte/icons/square-check';
	import ArrowDownUp from '@lucide/svelte/icons/arrow-down-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Mail from '@lucide/svelte/icons/mail';
	import Star from '@lucide/svelte/icons/star';
	import User from '@lucide/svelte/icons/user';
	import Type from '@lucide/svelte/icons/type';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import X from '@lucide/svelte/icons/x';
	import AlarmClock from '@lucide/svelte/icons/alarm-clock';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Menu from '@lucide/svelte/icons/menu';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Search from '@lucide/svelte/icons/search';
	import { mailNav } from '$core/stores/nav.svelte';
	import MessageRow from './MessageRow.svelte';
	import {
		bucketFromEpoch,
		dayBucketLabel,
		GROUP_ORDER,
		LABELS,
		SORT_OPTIONS,
		EMPTY_FILTERS,
		countActiveFilters,
		isDateSort,
		type ListFilters,
		type Message,
		type SortId
	} from './data';
	import type { MailActionCaps } from './actions';

	export type BulkAction = 'read' | 'archive' | 'spam' | 'trash' | 'restore' | 'delete';

	interface Props {
		folderLabel: string;
		list: Message[];
		activeId: string | null;
		checked: Set<string>;
		allChecked: boolean;
		sort: SortId;
		filters: ListFilters;
		caps: MailActionCaps;
		onOpen: (m: Message) => void;
		onToggleStar: (id: string) => void;
		onToggleCheck: (id: string) => void;
		onArchive: (id: string) => void;
		onTrash: (id: string) => void;
		onRestore?: (id: string) => void;
		onDelete?: (id: string) => void;
		onSpam?: (id: string) => void;
		onToggleRead: (id: string) => void;
		onToggleAll: () => void;
		onBulk: (action: BulkAction) => void;
		onSort: (id: SortId) => void;
		onSetFilters: (next: ListFilters) => void;
		onRefresh?: () => Promise<void>;
		exhausted?: boolean;
		loadingMore?: boolean;
		loadMoreError?: string | null;
		onLoadMore?: () => void;
		returnedCount?: number;
		onDismissReturned?: () => void;
		pendingCount?: number;
		onFlushPending?: () => void;
		onAtTopChange?: (atTop: boolean) => void;
		searchActive?: boolean;
		searchPending?: boolean;
		searchIndexed?: number;
		searchComplete?: boolean;
		searchChips?: string[];
		onClearSearch?: () => void;
	}

	let {
		folderLabel,
		list,
		activeId,
		checked,
		allChecked,
		sort,
		filters,
		caps,
		onOpen,
		onToggleStar,
		onToggleCheck,
		onArchive,
		onTrash,
		onRestore,
		onDelete,
		onSpam,
		onToggleRead,
		onToggleAll,
		onBulk,
		onSort,
		onSetFilters,
		onRefresh,
		exhausted = false,
		loadingMore = false,
		loadMoreError = null,
		onLoadMore = () => {},
		returnedCount = 0,
		onDismissReturned,
		pendingCount = 0,
		onFlushPending,
		onAtTopChange,
		searchActive = false,
		searchPending = false,
		searchIndexed = 0,
		searchComplete = true,
		searchChips = [],
		onClearSearch = () => {}
	}: Props = $props();

	const anyChecked = $derived(checked.size > 0);
	const activeFilters = $derived(countActiveFilters(filters));

	const counted = $derived(new Intl.NumberFormat().format(searchIndexed));
	const searchScopeText = $derived(
		!searchComplete
			? msg.mail_list_search_reading({ count: counted })
			: searchChips.length
				? msg.mail_list_search_all()
				: msg.mail_list_search_all_detail()
	);
	const emptyTitle = $derived(
		searchActive
			? searchPending
				? msg.mail_list_searching()
				: msg.mail_no_matches()
			: activeFilters > 0
				? msg.mail_list_nothing_matches()
				: msg.mail_list_folder_empty({ folder: folderLabel })
	);
	const emptyDetail = $derived(
		searchActive
			? searchPending
				? msg.mail_list_searching_detail()
				: searchComplete
					? msg.mail_list_search_none()
					: msg.mail_list_search_none_yet({ count: counted })
			: activeFilters > 0
				? msg.mail_list_filters_none()
				: msg.mail_list_empty_detail()
	);

	let refreshing = $state(false);
	const SPIN_MS = 800;
	async function doRefresh() {
		if (!onRefresh || refreshing) return;
		refreshing = true;
		const start = performance.now();
		try {
			await onRefresh();
		} finally {
			const elapsed = performance.now() - start;
			const target = Math.max(SPIN_MS, Math.ceil(elapsed / SPIN_MS) * SPIN_MS);
			await new Promise((r) => setTimeout(r, target - elapsed));
			refreshing = false;
		}
	}

	const sortIcons: Record<string, typeof ArrowDown> = {
		'arrow-down': ArrowDown,
		'arrow-up': ArrowUp,
		mail: Mail,
		star: Star,
		user: User,
		type: Type
	};

	const groups = $derived.by(() => {
		if (isDateSort(sort)) {
			const nowMs = Date.now();
			const order = sort === 'oldest' ? GROUP_ORDER.slice().reverse() : GROUP_ORDER;
			return order
				.map((g) => ({ g, items: list.filter((m) => bucketFromEpoch(m.epoch, nowMs) === g) }))
				.filter((x) => x.items.length);
		}
		return [{ g: null as string | null, items: list }];
	});

	let sortOpen = $state(false);
	let sortRef: HTMLDivElement | undefined = $state();
	let filterOpen = $state(false);
	let filterRef: HTMLDivElement | undefined = $state();

	function handleDocMouseDown(e: MouseEvent) {
		const t = e.target as Node;
		if (sortOpen && sortRef && !sortRef.contains(t)) sortOpen = false;
		if (filterOpen && filterRef && !filterRef.contains(t)) filterOpen = false;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (sortOpen) {
			sortOpen = false;
			e.stopPropagation();
		} else if (filterOpen) {
			filterOpen = false;
			e.stopPropagation();
		}
	}

	function pickSort(id: SortId) {
		onSort(id);
		sortOpen = false;
	}

	function toggleFlag(key: 'unread' | 'starred' | 'attach') {
		onSetFilters({ ...filters, [key]: !filters[key] });
	}

	function toggleLabel(id: keyof typeof LABELS) {
		const has = filters.labels.includes(id);
		onSetFilters({
			...filters,
			labels: has ? filters.labels.filter((l) => l !== id) : [...filters.labels, id]
		});
	}

	function clearFilters() {
		onSetFilters({ ...EMPTY_FILTERS });
	}

	interface PaginationProps {
		exhausted: boolean;
		loadingMore: boolean;
		loadMoreError: string | null;
		onLoadMore: () => void;
	}

	let scrollEl: HTMLDivElement | undefined = $state();
	let sentinelEl: HTMLDivElement | undefined = $state();
	let observer: IntersectionObserver | undefined;

	$effect(() => {
		if (!sentinelEl || !scrollEl) return;
		observer?.disconnect();
		observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting && !exhausted && !loadingMore) onLoadMore?.();
				}
			},
			{ root: scrollEl, rootMargin: '320px 0px 0px 0px' }
		);
		observer.observe(sentinelEl);
		return () => observer?.disconnect();
	});

	$effect(() => {
		if (!scrollEl || !onAtTopChange) return;
		const check = () => onAtTopChange(scrollEl!.scrollTop <= 4);
		check();
		scrollEl.addEventListener('scroll', check, { passive: true });
		return () => scrollEl?.removeEventListener('scroll', check);
	});
</script>

<svelte:document onmousedown={handleDocMouseDown} onkeydown={handleKey} />

<section class="list">
	{#if anyChecked}
		<div class="bulk">
			<button class="ck" class:on={allChecked} onclick={onToggleAll}><Check size={12} /></button>
			<span class="cnt">{msg.mail_list_selected({ count: checked.size })}</span>
			<div class="grow"></div>
			{#if caps.showMarkRead}
				<button class="lh-btn" title={msg.mail_list_mark_read()} onclick={() => onBulk('read')}>
					<MailOpen size={16} />
				</button>
			{/if}
			{#if caps.showRestore}
				<button class="lh-btn" data-mutates title={msg.mail_action_restore()} onclick={() => onBulk('restore')}>
					<Undo2 size={16} />
				</button>
			{/if}
			{#if caps.showArchive}
				<button class="lh-btn" data-mutates title={msg.mail_action_archive()} onclick={() => onBulk('archive')}>
					<Archive size={16} />
				</button>
			{/if}
			{#if caps.showSpam}
				<button class="lh-btn" title={msg.mail_action_report_spam()} onclick={() => onBulk('spam')}>
					<ShieldAlert size={16} />
				</button>
			{/if}
			{#if caps.showTrash}
				<button class="lh-btn" data-mutates title={msg.mail_action_trash()} onclick={() => onBulk('trash')}>
					<Trash2 size={16} />
				</button>
			{/if}
			{#if caps.showDelete}
				<button class="lh-btn lh-btn-danger" data-mutates title={msg.mail_action_delete_forever()} onclick={() => onBulk('delete')}>
					<Trash2 size={16} />
				</button>
			{/if}
		</div>
	{:else}
		<div class="list-h">
			<button class="lh-nav" title={msg.mail_menu()} onclick={() => (mailNav.open = !mailNav.open)}>
				<Menu size={18} />
			</button>
			<div class="ttl-block">
				<span class="ttl">{folderLabel}{#if list.length}<span class="n">{list.length}</span>{/if}</span>
				{#if sort !== 'newest' || activeFilters > 0}
					<div class="list-sub">
						{#if sort !== 'newest'}
							<span>{msg.mail_list_sorted_by({ sort: SORT_OPTIONS.find((o) => o.id === sort)?.label ?? '' })}</span>
							<button
								type="button"
								class="list-sub-x"
								title={msg.mail_list_reset_sort()}
								onclick={() => onSort('newest')}
							>
								<X size={11} />
							</button>
						{/if}
						{#if sort !== 'newest' && activeFilters > 0}
							<span class="list-sub-dot">·</span>
						{/if}
						{#if activeFilters > 0}
							<span>{msg.mail_list_filters_active({ count: activeFilters })}</span>
							<button
								type="button"
								class="list-sub-x"
								title={msg.mail_list_clear_filters()}
								onclick={clearFilters}
							>
								<X size={11} />
							</button>
						{/if}
					</div>
				{/if}
			</div>
			<div class="grow"></div>
			{#if onRefresh}
				<button class="lh-btn" class:refreshing title={msg.mail_refresh()} disabled={refreshing} onclick={doRefresh}>
					<RefreshCw size={16} />
				</button>
			{/if}
			<button class="lh-btn" title={msg.mail_list_select_all()} onclick={onToggleAll}>
				<SquareCheck size={16} />
			</button>
			<div class="lh-sort" bind:this={sortRef}>
				<button
					class="lh-btn"
					class:on={sortOpen}
					title={msg.mail_list_sort()}
					aria-haspopup="menu"
					aria-expanded={sortOpen}
					onclick={() => (sortOpen = !sortOpen)}
				>
					<ArrowDownUp size={16} />
				</button>
				{#if sortOpen}
					<div class="menu sort-menu" role="menu">
						<div class="menu-lbl">{msg.mail_list_sort_by()}</div>
						{#each SORT_OPTIONS as o (o.id)}
							{@const SIcon = sortIcons[o.icon] ?? ArrowDown}
							<button
								class="mitem"
								class:active={sort === o.id}
								role="menuitemradio"
								aria-checked={sort === o.id}
								onclick={() => pickSort(o.id)}
							>
								<SIcon size={16} />{o.label}
								{#if sort === o.id}
									<span class="mck"><Check size={16} /></span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
			<div class="lh-filter" bind:this={filterRef}>
				<button
					class="lh-btn"
					class:on={filterOpen || activeFilters > 0}
					title={msg.mail_list_filter()}
					aria-haspopup="dialog"
					aria-expanded={filterOpen}
					onclick={() => (filterOpen = !filterOpen)}
				>
					<SlidersHorizontal size={16} />
					{#if activeFilters > 0}
						<span class="fbadge">{activeFilters}</span>
					{/if}
				</button>
				{#if filterOpen}
					<div class="menu filter-menu" role="dialog" aria-label={msg.mail_list_filter_aria()}>
						<div class="fm-head">
							<span class="menu-lbl">{msg.mail_list_filter()}</span>
							{#if activeFilters > 0}
								<button class="fm-clear" onclick={clearFilters}>{msg.mail_list_clear_all()}</button>
							{/if}
						</div>
						<div class="fm-cap">{msg.mail_list_show_only()}</div>
						<div class="fm-chips">
							<button
								class="fchip"
								class:on={filters.unread}
								aria-pressed={filters.unread}
								onclick={() => toggleFlag('unread')}
							>
								<Mail size={15} />{msg.mail_list_filter_unread()}
							</button>
							<button
								class="fchip"
								class:on={filters.starred}
								aria-pressed={filters.starred}
								onclick={() => toggleFlag('starred')}
							>
								<Star size={15} />{msg.mail_list_filter_starred()}
							</button>
							<button
								class="fchip"
								class:on={filters.attach}
								aria-pressed={filters.attach}
								onclick={() => toggleFlag('attach')}
							>
								<Paperclip size={15} />{msg.mail_list_filter_attach()}
							</button>
						</div>
						<div class="msep"></div>
						<div class="fm-cap">{msg.mail_list_labels()}</div>
						<div class="fm-chips">
							{#each Object.entries(LABELS) as [id, l] (id)}
								{@const on = filters.labels.includes(id as keyof typeof LABELS)}
								<button
									class="fchip"
									class:on
									aria-pressed={on}
									onclick={() => toggleLabel(id as keyof typeof LABELS)}
								>
									<span class="fdot" style:background={l.color}></span>{l.name}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
	<div class="scroll" bind:this={scrollEl}>
		{#if pendingCount > 0}
			<button type="button" class="new-strip" onclick={onFlushPending}>
				<ArrowUp size={14} />
				<span>{msg.mail_list_new_messages({ count: pendingCount })}</span>
			</button>
		{/if}
		{#if returnedCount > 0}
			<div class="snz-strip">
				<AlarmClock size={15} />
				<span>{msg.mail_list_snooze_returned({ count: returnedCount })}</span>
				{#if onDismissReturned}
					<button type="button" class="snz-x" title={msg.mail_list_dismiss()} onclick={onDismissReturned}>
						<X size={13} />
					</button>
				{/if}
			</div>
		{/if}
		{#if searchActive}
			<div class="srch-strip">
				<Search size={14} />
				<span>{searchScopeText}</span>
				{#each searchChips as chip (chip)}
					<span class="srch-chip">{chip}</span>
				{/each}
			</div>
		{/if}
		{#if list.length === 0}
			<div class="empty-list">
				<span class="el-rule"></span>
				<div class="t">{emptyTitle}</div>
				<div class="d">{emptyDetail}</div>
				{#if searchActive}
					<button class="empty-clear" onclick={onClearSearch}><X size={14} />{msg.mail_list_clear_search()}</button>
				{:else if activeFilters > 0}
					<button class="empty-clear" onclick={clearFilters}><X size={14} />{msg.mail_list_clear_filters()}</button>
				{/if}
			</div>
		{:else}
			{#each groups as { g, items } (g ?? 'all')}
				{#if g}
					<div class="daygrp"><span class="l">{dayBucketLabel(g)}</span><span class="rule"></span></div>
				{/if}
				{#each items as m (m.id)}
					<MessageRow
						{m}
						active={activeId === m.id}
						checked={checked.has(m.id)}
						{anyChecked}
						{caps}
						{onOpen}
						{onToggleStar}
						{onToggleCheck}
						{onArchive}
						{onTrash}
						{onRestore}
						{onDelete}
						{onSpam}
						{onToggleRead}
					/>
				{/each}
			{/each}
		{/if}
		{#if !searchActive}
			<div class="list-foot" bind:this={sentinelEl}>
				{#if loadMoreError}
					<button class="lf-retry" onclick={onLoadMore}>{msg.mail_list_load_more_failed()}</button>
				{:else if loadingMore}
					<span class="lf-spin"></span><span class="lf-text">{msg.mail_list_loading_more()}</span>
				{:else if exhausted && list.length > 0}
					<span class="lf-hair"></span>
					<span class="lf-text">{msg.mail_list_end()}</span>
					<span class="lf-hair"></span>
				{/if}
			</div>
		{/if}
	</div>
</section>
