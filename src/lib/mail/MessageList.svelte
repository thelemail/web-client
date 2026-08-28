<script lang="ts">
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
	import Menu from '@lucide/svelte/icons/menu';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { mailNav } from '$lib/stores/nav.svelte';
	import MessageRow from './MessageRow.svelte';
	import {
		bucketFromEpoch,
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

	export type BulkAction = 'read' | 'archive' | 'trash' | 'restore' | 'delete';

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
		onAtTopChange
	}: Props = $props();

	const anyChecked = $derived(checked.size > 0);
	const activeFilters = $derived(countActiveFilters(filters));

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
			<span class="cnt">{checked.size} selected</span>
			<div class="grow"></div>
			{#if caps.showMarkRead}
				<button class="lh-btn" title="Mark read" onclick={() => onBulk('read')}>
					<MailOpen size={16} />
				</button>
			{/if}
			{#if caps.showRestore}
				<button class="lh-btn" title="Restore" onclick={() => onBulk('restore')}>
					<Undo2 size={16} />
				</button>
			{/if}
			{#if caps.showArchive}
				<button class="lh-btn" title="Archive" onclick={() => onBulk('archive')}>
					<Archive size={16} />
				</button>
			{/if}
			{#if caps.showTrash}
				<button class="lh-btn" title="Move to trash" onclick={() => onBulk('trash')}>
					<Trash2 size={16} />
				</button>
			{/if}
			{#if caps.showDelete}
				<button class="lh-btn lh-btn-danger" title="Permanently delete" onclick={() => onBulk('delete')}>
					<Trash2 size={16} />
				</button>
			{/if}
		</div>
	{:else}
		<div class="list-h">
			<button class="lh-nav" title="Menu" onclick={() => (mailNav.open = !mailNav.open)}>
				<Menu size={18} />
			</button>
			<div class="ttl-block">
				<span class="ttl">{folderLabel}{#if list.length}<span class="n">{list.length}</span>{/if}</span>
				{#if sort !== 'newest' || activeFilters > 0}
					<div class="list-sub">
						{#if sort !== 'newest'}
							<span>Sorted by {SORT_OPTIONS.find((o) => o.id === sort)?.label}</span>
							<button
								type="button"
								class="list-sub-x"
								title="Reset sort"
								onclick={() => onSort('newest')}
							>
								<X size={11} />
							</button>
						{/if}
						{#if sort !== 'newest' && activeFilters > 0}
							<span class="list-sub-dot">·</span>
						{/if}
						{#if activeFilters > 0}
							<span>{activeFilters} filter{activeFilters > 1 ? 's' : ''} active</span>
							<button
								type="button"
								class="list-sub-x"
								title="Clear filters"
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
				<button class="lh-btn" class:refreshing title="Refresh" disabled={refreshing} onclick={doRefresh}>
					<RefreshCw size={16} />
				</button>
			{/if}
			<button class="lh-btn" title="Select all" onclick={onToggleAll}>
				<SquareCheck size={16} />
			</button>
			<div class="lh-sort" bind:this={sortRef}>
				<button
					class="lh-btn"
					class:on={sortOpen}
					title="Sort"
					aria-haspopup="menu"
					aria-expanded={sortOpen}
					onclick={() => (sortOpen = !sortOpen)}
				>
					<ArrowDownUp size={16} />
				</button>
				{#if sortOpen}
					<div class="menu sort-menu" role="menu">
						<div class="menu-lbl">Sort by</div>
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
					title="Filter"
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
					<div class="menu filter-menu" role="dialog" aria-label="Filter messages">
						<div class="fm-head">
							<span class="menu-lbl">Filter</span>
							{#if activeFilters > 0}
								<button class="fm-clear" onclick={clearFilters}>Clear all</button>
							{/if}
						</div>
						<div class="fm-cap">Show only</div>
						<div class="fm-chips">
							<button
								class="fchip"
								class:on={filters.unread}
								aria-pressed={filters.unread}
								onclick={() => toggleFlag('unread')}
							>
								<Mail size={15} />Unread
							</button>
							<button
								class="fchip"
								class:on={filters.starred}
								aria-pressed={filters.starred}
								onclick={() => toggleFlag('starred')}
							>
								<Star size={15} />Starred
							</button>
							<button
								class="fchip"
								class:on={filters.attach}
								aria-pressed={filters.attach}
								onclick={() => toggleFlag('attach')}
							>
								<Paperclip size={15} />Has files
							</button>
						</div>
						<div class="msep"></div>
						<div class="fm-cap">Labels</div>
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
				<span>{pendingCount} new message{pendingCount > 1 ? 's' : ''}</span>
			</button>
		{/if}
		{#if returnedCount > 0}
			<div class="snz-strip">
				<AlarmClock size={15} />
				<span
					>{returnedCount} conversation{returnedCount > 1 ? 's' : ''} came back from snooze</span
				>
				{#if onDismissReturned}
					<button type="button" class="snz-x" title="Dismiss" onclick={onDismissReturned}>
						<X size={13} />
					</button>
				{/if}
			</div>
		{/if}
		{#if list.length === 0}
			<div class="empty-list">
				<span class="el-rule"></span>
				<div class="t">{activeFilters > 0 ? 'Nothing matches' : `${folderLabel} is empty`}</div>
				<div class="d">
					{activeFilters > 0
						? 'No message here fits the filters you have on.'
						: 'Nothing here yet.'}
				</div>
				{#if activeFilters > 0}
					<button class="empty-clear" onclick={clearFilters}><X size={14} />Clear filters</button>
				{/if}
			</div>
		{:else}
			{#each groups as { g, items } (g ?? 'all')}
				{#if g}
					<div class="daygrp"><span class="l">{g}</span><span class="rule"></span></div>
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
						{onToggleRead}
					/>
				{/each}
			{/each}
			<div class="list-foot" bind:this={sentinelEl}>
				{#if loadMoreError}
					<button class="lf-retry" onclick={onLoadMore}>Could not load more — Retry</button>
				{:else if loadingMore}
					<span class="lf-spin"></span><span class="lf-text">Loading more…</span>
				{:else if exhausted}
					<span class="lf-hair"></span>
					<span class="lf-text">— end of conversation list —</span>
					<span class="lf-hair"></span>
				{/if}
			</div>
		{/if}
	</div>
</section>
