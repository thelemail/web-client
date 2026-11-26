<script lang="ts">
	import { formatNumber } from '$core/i18n/intl';
	import { canFinishSearchSetup, finishSearchSetup } from '$core/custody/search-setup';
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import { untrack } from 'svelte';
	import { m as msg } from '$paraglide/messages.js';
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import * as Tooltip from '$core/components/ui/tooltip';
	import { createTipTether } from '$core/components/ui/tooltip/shared';
	import { Chip } from '$core/components/ui/chip';
	import { EmptyState } from '$core/components/ui/empty-state';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import * as Popover from '$core/components/ui/popover';
	import { Segmented } from '$core/components/ui/segmented';
	import {
		faAlarmClock,
		faArrowDown,
		faArrowDownArrowUp,
		faArrowRotateLeft,
		faArrowUp,
		faArrowsRotate,
		faBoxArchive,
		faCircleExclamation,
		faEnvelope,
		faEnvelopeOpen,
		faFilter,
		faFolder,
		faFolderArrowDown,
		faFont,
		faInbox,
		faMagnifyingGlass,
		faPaperclip,
		faShieldExclamation,
		faSliders,
		faSquareCheck,
		faStar,
		faTag,
		faTrashCan,
		faUser,
		faWifiSlash,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import MessageRow from './MessageRow.svelte';
	import { loadSearchStrip, loadedSearchStrip, type SearchStripComponent } from './searchStrip';
	import type { SearchView } from './searchView';
	import ListSkeleton from './ListSkeleton.svelte';
	import LoadState from '$core/components/LoadState.svelte';
	import { delayed } from '$core/async/delayed.svelte';
	import {
		bucketFromEpoch,
		dayBucketLabel,
		GROUP_ORDER,
		SORT_OPTIONS,
		EMPTY_FILTERS,
		countActiveFilters,
		isDateSort,
		type ListFilters,
		type Message,
		type SortId
	} from './data';
	import type { MailActionCaps } from './actions';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { collectionColor } from './collections/palette';

	export type BulkAction = 'read' | 'archive' | 'spam' | 'trash' | 'restore' | 'delete';

	interface Props {
		folderLabel: string | null;
		folderUnread?: number;
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
		onSelect?: (id: string, range: boolean) => void;
		viewFolder: string;
		querySelected?: number | null;
		matchingTotal?: number | null;
		onSelectMatching?: () => void;
		onClearSelection?: () => void;
		job?: { text: string; stopping: boolean } | null;
		onStopJob?: () => void;
		onBulk: (action: BulkAction) => void;
		onPicker?: (kind: 'move' | 'labels', anchor: HTMLElement) => void;
		openPicker?: string | null;
		onSort: (id: SortId) => void;
		onSetFilters: (next: ListFilters) => void;
		onRefresh?: () => Promise<void>;
		exhausted?: boolean;
		loadingMore?: boolean;
		loadMoreError?: string | null;
		loaded?: boolean;
		loadError?: string | null;
		listRefreshing?: boolean;
		offline?: boolean;
		onRetry?: () => void;
		onLoadMore?: () => void;
		returnedCount?: number;
		onDismissReturned?: () => void;
		pendingCount?: number;
		onFlushPending?: () => void;
		onAtTopChange?: (atTop: boolean) => void;
		search?: SearchView | null;
		collectionKind?: 'folder' | 'label' | null;
		showScope?: boolean;
	}

	let {
		folderLabel,
		folderUnread = 0,
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
		onSelect,
		viewFolder,
		querySelected = null,
		matchingTotal,
		onSelectMatching,
		onClearSelection,
		job = null,
		onStopJob,
		onBulk,
		onPicker,
		openPicker = null,
		onSort,
		onSetFilters,
		onRefresh,
		exhausted = false,
		loadingMore = false,
		loadMoreError = null,
		loaded = true,
		loadError = null,
		listRefreshing = false,
		offline = false,
		onRetry,
		onLoadMore = () => {},
		returnedCount = 0,
		onDismissReturned,
		pendingCount = 0,
		onFlushPending,
		onAtTopChange,
		search = null,
		collectionKind = null,
		showScope = false
	}: Props = $props();

	const rowTips = createTipTether();
	const viewName = $derived(folderLabel ?? '');
	const searchActive = $derived(search !== null);
	let SearchStrip = $state.raw<SearchStripComponent | null>(loadedSearchStrip());
	$effect(() => {
		if (search && !SearchStrip) void loadSearchStrip().then((c) => (SearchStrip = c));
	});
	const relatedRows = $derived(search?.related?.status === 'ready' ? search.related.rows : []);
	const relatedPending = $derived(list.length === 0 && search?.related?.status === 'loading');
	const firstLoad = delayed(() => !searchActive && !loaded && !loadError);
	const inQuery = $derived(querySelected !== null);
	const anyChecked = $derived(checked.size > 0 || inQuery);
	const fmt = (n: number) => formatNumber(n);
	const activeFilters = $derived(countActiveFilters(filters));

	const searchEmpty = $derived.by<{ title: string; detail: string; retry: boolean; finish?: boolean } | null>(() => {
		if (!search) return null;
		switch (search.phase) {
			case 'failed':
				return search.error
					? { title: msg.mail_search_query_invalid(), detail: search.error, retry: false }
					: { title: msg.mail_search_failed(), detail: msg.mail_search_failed_detail(), retry: true };
			case 'locked':
				return { title: msg.mail_search_locked(), detail: msg.mail_search_locked_detail(), retry: false };
			case 'unconverted':
				return { title: msg.mail_search_unconverted(), detail: msg.mail_search_unconverted_detail(), retry: false, finish: canFinishSearchSetup() };
			case 'unavailable':
				return { title: msg.mail_search_unavailable(), detail: msg.mail_search_unavailable_detail(), retry: true };
			case 'starting':
			case 'searching':
				return { title: msg.mail_list_searching(), detail: msg.mail_list_searching_detail(), retry: false };
			default:
				return search.mode === 'desktop' || search.coverage?.complete
					? { title: msg.mail_no_matches(), detail: msg.mail_list_search_none(), retry: false }
					: { title: msg.mail_search_none_indexed(), detail: msg.mail_search_none_indexed_detail(), retry: false };
		}
	});
	const errorParts = $derived.by(() => {
		const r = search?.errorRange;
		const q = search?.query ?? '';
		if (!search?.error || !r || r.end <= r.start || r.start >= q.length) return null;
		return { before: q.slice(0, r.start), bad: q.slice(r.start, r.end), after: q.slice(r.end) };
	});
	const emptyTitle = $derived(
		searchEmpty ? searchEmpty.title : activeFilters > 0 ? msg.mail_list_nothing_matches() : msg.mail_list_folder_empty({ folder: viewName })
	);
	const emptyDetail = $derived(searchEmpty ? searchEmpty.detail : activeFilters > 0 ? msg.mail_list_filters_none() : msg.mail_list_empty_detail());

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

	const sortIcons: Record<string, IconDefinition> = {
		'arrow-down': faArrowDown,
		'arrow-up': faArrowUp,
		mail: faEnvelope,
		star: faStar,
		user: faUser,
		type: faFont
	};

	const groups = $derived.by(() => {
		if (isDateSort(sort)) {
			const nowMs = Date.now();
			const order = sort === 'oldest' ? GROUP_ORDER.slice().reverse() : GROUP_ORDER;
			const buckets = new Map(order.map((g) => [g, [] as typeof list]));
			for (const m of list) buckets.get(bucketFromEpoch(m.epoch, nowMs))?.push(m);
			return order.map((g) => ({ g, items: buckets.get(g)! })).filter((x) => x.items.length);
		}
		return [{ g: null as string | null, items: list }];
	});

	const FIRST_ROWS = 24;
	const MORE_ROWS = 40;
	let rowCapState = $state({ view: '', count: FIRST_ROWS });
	const rowCap = $derived.by(() => {
		const base = rowCapState.view === viewKey ? rowCapState.count : FIRST_ROWS;
		const open = activeId ? list.findIndex((m) => m.id === activeId) + 1 : 0;
		return Math.max(base, open);
	});
	const allRowsShown = $derived(rowCap >= list.length);
	const shownGroups = $derived.by(() => {
		if (allRowsShown) return groups;
		let left = rowCap;
		const out: typeof groups = [];
		for (const group of groups) {
			if (left <= 0) break;
			const items = group.items.length > left ? group.items.slice(0, left) : group.items;
			out.push({ g: group.g, items });
			left -= items.length;
		}
		return out;
	});

	$effect(() => {
		if (allRowsShown) return;
		const next = { view: viewKey, count: rowCap + MORE_ROWS };
		let timer: ReturnType<typeof setTimeout> | undefined;
		const frame = requestAnimationFrame(() => {
			timer = setTimeout(() => (rowCapState = next), 0);
		});
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	});

	let sortOpen = $state(false);
	let filterOpen = $state(false);

	function pickSort(id: SortId) {
		onSort(id);
		sortOpen = false;
	}

	function setUnreadOnly(on: boolean) {
		if (filters.unread !== on) onSetFilters({ ...filters, unread: on });
	}

	function toggleFlag(key: 'unread' | 'starred' | 'attach' | 'direct') {
		onSetFilters({ ...filters, [key]: !filters[key] });
	}

	function toggleLabel(id: string) {
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
			{ root: scrollEl, rootMargin: '0px 0px 320px 0px' }
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

	type Anchor = { view: string; rows: { id: string; offset: number }[] };

	const rowIds = $derived(list.map((m) => m.id).join(' '));
	const viewKey = $derived(
		[viewFolder, sort, JSON.stringify(filters), searchActive].join('|')
	);
	let anchor: Anchor | null = null;
	let pendingRestore: { view: string; top: number } | null = null;
	let shownView: string | null = null;
	let jumpToTop = false;
	let lastTop = 0;
	let lastActive: string | null = null;

	function rowEls(): HTMLElement[] {
		return scrollEl ? [...scrollEl.querySelectorAll<HTMLElement>('.mrow')] : [];
	}

	function rowEl(id: string): HTMLElement | undefined {
		return scrollEl?.querySelector<HTMLElement>(`.mrow[data-id="${CSS.escape(id)}"]`) ?? undefined;
	}

	function revealRow(id: string) {
		const row = rowEl(id);
		if (!row || !scrollEl) return;
		const box = row.getBoundingClientRect();
		const view = scrollEl.getBoundingClientRect();
		if (box.top >= view.top && box.bottom <= view.bottom) return;
		row.scrollIntoView?.({ block: 'nearest' });
	}

	function captureAnchor(): Anchor | null {
		if (!scrollEl || scrollEl.scrollTop <= 4) return null;
		const top = scrollEl.getBoundingClientRect().top;
		const rows: Anchor['rows'] = [];
		for (const r of rowEls()) {
			const box = r.getBoundingClientRect();
			if (box.bottom <= top || !r.dataset.id) continue;
			rows.push({ id: r.dataset.id, offset: box.top - top });
			if (rows.length === 3) break;
		}
		return rows.length ? { view: viewKey, rows } : null;
	}

	function restoreAnchor(a: Anchor) {
		if (!scrollEl || a.view !== viewKey) return;
		const top = scrollEl.getBoundingClientRect().top;
		for (const { id, offset } of a.rows) {
			const r = rowEl(id);
			if (!r) continue;
			const delta = r.getBoundingClientRect().top - top - offset;
			if (delta) scrollEl.scrollTop += delta;
			return;
		}
	}

	$effect.pre(() => {
		void rowIds;
		void pendingCount;
		void returnedCount;
		untrack(() => {
			anchor = captureAnchor();
		});
	});

	$effect(() => {
		void rowIds;
		void pendingCount;
		void returnedCount;
		untrack(() => {
			if (jumpToTop && scrollEl) {
				jumpToTop = false;
				scrollEl.scrollTop = 0;
			} else if (anchor) {
				restoreAnchor(anchor);
			}
			anchor = null;
		});
	});

	$effect(() => {
		const view = viewKey;
		const complete = allRowsShown;
		void rowIds;
		untrack(() => {
			if (!scrollEl) return;
			if (pendingRestore && pendingRestore.view === view && list.length > 0) {
				if (!complete) {
					rowCapState = { view, count: list.length };
					return;
				}
				scrollEl.scrollTop = pendingRestore.top;
				lastTop = pendingRestore.top;
				pendingRestore = null;
			} else if (shownView !== null && shownView !== view) {
				scrollEl.scrollTop = 0;
				lastTop = 0;
			}
			shownView = view;
		});
	});

	export function scrollPosition(): { view: string; top: number } {
		return { view: viewKey, top: scrollEl?.scrollTop ?? 0 };
	}

	export function restoreScroll(position: { view: string; top: number }) {
		pendingRestore = position;
		if (!allRowsShown && position.view === viewKey) {
			rowCapState = { view: viewKey, count: list.length };
			return;
		}
		if (scrollEl && position.view === viewKey && list.length > 0) {
			scrollEl.scrollTop = position.top;
			lastTop = position.top;
			pendingRestore = null;
		}
	}

	$effect(() => {
		if (!scrollEl) return;
		const el = scrollEl;
		const track = () => {
			if (el.clientHeight > 0) lastTop = el.scrollTop;
		};
		el.addEventListener('scroll', track, { passive: true });
		return () => el.removeEventListener('scroll', track);
	});

	$effect(() => {
		const id = activeId;
		untrack(() => {
			const prev = lastActive;
			lastActive = id;
			if (id) {
				revealRow(id);
				return;
			}
			if (!prev || !scrollEl) return;
			if (scrollEl.clientHeight > 0 && scrollEl.scrollTop !== lastTop) scrollEl.scrollTop = lastTop;
			const focused = document.activeElement;
			if (focused && focused !== document.body && !focused.closest('.reader')) return;
			rowEl(prev)?.querySelector<HTMLElement>('.mrow-open')?.focus({ preventScroll: true });
		});
	});

	let arrived = $state<Set<string>>(new Set());
	let seen: { view: string; ids: Set<string> } | null = null;
	let arrivedTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const ids = list.map((m) => m.id);
		const view = viewKey;
		untrack(() => {
			const prev = seen;
			seen = { view, ids: new Set(ids) };
			if (!prev || prev.view !== view || prev.ids.size === 0) return;
			const firstKnown = ids.findIndex((id) => prev.ids.has(id));
			const fresh = ids.slice(0, firstKnown < 0 ? 0 : firstKnown);
			if (fresh.length === 0) return;
			arrived = new Set(fresh);
			clearTimeout(arrivedTimer);
			arrivedTimer = setTimeout(() => (arrived = new Set()), 700);
		});
	});

	$effect(() => () => clearTimeout(arrivedTimer));

	function flushPending() {
		jumpToTop = true;
		onFlushPending?.();
	}
</script>

{#snippet row(m: Message)}
	<MessageRow
		{m}
		active={activeId === m.id}
		fresh={arrived.has(m.id)}
		checked={inQuery || checked.has(m.id)}
		{anyChecked}
		{caps}
		{viewFolder}
		searching={searchActive}
		{onOpen}
		{onSelect}
		{onToggleStar}
		{onToggleCheck}
		{onArchive}
		{onTrash}
		{onRestore}
		{onDelete}
		{onSpam}
		{onToggleRead}
		tips={rowTips}
	/>
{/snippet}

<section class="list">
	{#if anyChecked}
		<div class="bulk">
			<button
				type="button"
				class="check"
				data-state={allChecked || inQuery ? 'checked' : 'indeterminate'}
				aria-label={allChecked || inQuery ? msg.mail_list_clear_selection() : msg.mail_list_select_all()}
				onclick={onToggleAll}
			></button>
			<span class="cnt">
				{inQuery
					? msg.mail_list_selected_all_matching({ count: fmt(querySelected ?? 0), view: viewName })
					: msg.mail_list_selected({ count: checked.size })}
			</span>
			<div class="grow"></div>
			{#if caps.showMarkRead && !inQuery}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					tooltip={msg.mail_list_mark_read()}
					onclick={() => onBulk('read')}
				>
					<Icon icon={faEnvelopeOpen} size={16} />
				</Button>
			{/if}
			{#if caps.showRestore && !inQuery}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					data-mutates
					tooltip={msg.mail_action_restore()}
					onclick={() => onBulk('restore')}
				>
					<Icon icon={faArrowRotateLeft} size={16} />
				</Button>
			{/if}
			{#if caps.showArchive}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					data-mutates
					tooltip={msg.mail_action_archive()}
					onclick={() => onBulk('archive')}
				>
					<Icon icon={faBoxArchive} size={16} />
				</Button>
			{/if}
			{#if caps.showMove && onPicker}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					data-mutates
					data-picker="bulk-move"
					tooltip={msg.mail_reader_move_to()}
					aria-haspopup="dialog"
					aria-expanded={openPicker === 'bulk-move'}
					onclick={(e) => onPicker('move', e.currentTarget)}
				>
					<Icon icon={faFolderArrowDown} size={16} />
				</Button>
			{/if}
			{#if caps.showLabels && onPicker}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					data-mutates
					data-picker="bulk-labels"
					tooltip={msg.mail_list_labels()}
					aria-haspopup="dialog"
					aria-expanded={openPicker === 'bulk-labels'}
					onclick={(e) => onPicker('labels', e.currentTarget)}
				>
					<Icon icon={faTag} size={16} />
				</Button>
			{/if}
			{#if caps.showSpam && !inQuery}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					tooltip={msg.mail_action_report_spam()}
					onclick={() => onBulk('spam')}
				>
					<Icon icon={faShieldExclamation} size={16} />
				</Button>
			{/if}
			{#if caps.showTrash && !inQuery}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					data-mutates
					tooltip={msg.mail_action_trash()}
					onclick={() => onBulk('trash')}
				>
					<Icon icon={faTrashCan} size={16} />
				</Button>
			{/if}
			{#if caps.showDelete && !inQuery}
				<Button
					variant="ghostDanger"
					size="icon-sm"
					class="lh-btn"
					data-mutates
					tooltip={msg.mail_action_delete_forever()}
					onclick={() => onBulk('delete')}
				>
					<Icon icon={faTrashCan} size={16} />
				</Button>
			{/if}
		</div>
	{:else}
		<div class="list-h">
			<h1 class="ttl">
				{#if folderLabel !== null}
					<span class="ttl-name">{folderLabel}</span>
				{:else}
					<span class="ttl-name ttl-wait" aria-hidden="true"></span>
				{/if}
				{#if folderUnread > 0}
					<span class="ttl-ct" title={msg.mail_list_unread_count({ count: fmt(folderUnread) })}>
						<span aria-hidden="true">{fmt(folderUnread)}</span>
						<span class="sr-only">{msg.mail_list_unread_count({ count: fmt(folderUnread) })}</span>
					</span>
				{/if}
			</h1>
			<Segmented
				class="seg"
				aria-label={msg.mail_list_show()}
				bind:value={() => (filters.unread ? 'unread' : 'all'), (v) => setUnreadOnly(v === 'unread')}
				options={[
					{ value: 'all', label: msg.mail_list_all() },
					{ value: 'unread', label: msg.mail_list_filter_unread() }
				]}
			/>
			<div class="lh-actions">
				{#if onRefresh}
					<Button
						variant="ghost"
						size="icon-sm"
						class={['lh-btn', { refreshing }]}
						tooltip={msg.mail_refresh()}
						disabled={refreshing}
						onclick={doRefresh}
					>
						<Icon icon={faArrowsRotate} size={16} />
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="icon-sm"
					class="lh-btn"
					tooltip={msg.mail_list_select_all()}
					onclick={onToggleAll}
				>
					<Icon icon={faSquareCheck} size={16} />
				</Button>
				<DropdownMenu.Root bind:open={sortOpen}>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-sm" class="lh-btn" tooltip={msg.mail_list_sort()}>
								<Icon icon={faArrowDownArrowUp} size={16} />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="sort-menu" portalProps={{ to: '.mail-app' }}>
						<DropdownMenu.RadioGroup value={sort} onValueChange={(v) => pickSort(v as SortId)}>
							<DropdownMenu.GroupHeading>{msg.mail_list_sort_by()}</DropdownMenu.GroupHeading>
							{#each SORT_OPTIONS as o (o.id)}
								{@const SIcon = sortIcons[o.icon] ?? faArrowDown}
								<DropdownMenu.RadioItem value={o.id}>
									<Icon icon={SIcon} size={16} />{o.label}
								</DropdownMenu.RadioItem>
							{/each}
						</DropdownMenu.RadioGroup>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<Popover.Root bind:open={filterOpen}>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon-sm" class="lh-btn lh-filter" tooltip={msg.mail_list_filter()}>
								<Icon icon={faSliders} size={16} />
								{#if activeFilters > 0}
									<span class="fbadge">{activeFilters}</span>
								{/if}
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content align="end" class="filter-menu" aria-label={msg.mail_list_filter_aria()} portalProps={{ to: '.mail-app' }}>
						<div class="fm-head">
							<p class="popover-label">{msg.mail_list_filter()}</p>
							{#if activeFilters > 0}
								<button type="button" class="fm-clear" onclick={clearFilters}>{msg.mail_list_clear_all()}</button>
							{/if}
						</div>
						<div class="fm-cap">{msg.mail_list_show_only()}</div>
						<div class="fm-chips">
							<Chip bind:pressed={() => filters.unread, () => toggleFlag('unread')}>
								{#snippet leading()}<Icon icon={faEnvelope} size={15} />{/snippet}
								{msg.mail_list_filter_unread()}
							</Chip>
							<Chip bind:pressed={() => filters.starred, () => toggleFlag('starred')}>
								{#snippet leading()}<Icon icon={faStar} size={15} />{/snippet}
								{msg.mail_list_filter_starred()}
							</Chip>
							<Chip bind:pressed={() => filters.attach, () => toggleFlag('attach')}>
								{#snippet leading()}<Icon icon={faPaperclip} size={15} />{/snippet}
								{msg.mail_list_filter_attach()}
							</Chip>
							{#if collectionKind && (showScope || filters.direct)}
								<Chip bind:pressed={() => !!filters.direct, () => toggleFlag('direct')}>
									{#snippet leading()}<Icon icon={collectionKind === 'label' ? faTag : faFolder} size={15} />{/snippet}
									{collectionKind === 'label' ? msg.mail_view_only_label() : msg.mail_view_only_folder()}
								</Chip>
							{/if}
						</div>
						{#if collectionKind !== 'label'}
							<div class="menu-sep fm-sep"></div>
							<div class="fm-cap">{msg.mail_list_labels()}</div>
							<div class="fm-chips">
								{#each mailCollections.labels.filter((l) => !l.sealed) as l (l.id)}
									{@const on = filters.labels.includes(l.id)}
									<Chip title={l.path} bind:pressed={() => on, () => toggleLabel(l.id)}>
										{#snippet leading()}<span class="fdot" style:background={collectionColor(l.color)}></span>{/snippet}
										{l.name}
									</Chip>
								{:else}
									<span class="fm-empty">{msg.mail_collection_no_labels()}</span>
								{/each}
							</div>
						{/if}
					</Popover.Content>
				</Popover.Root>
			</div>
		</div>
	{/if}
	{#if !anyChecked && (sort !== 'newest' || activeFilters > 0)}
		<div class="view-strip">
			{#if sort !== 'newest'}
				<Chip size="sm" removeLabel={msg.mail_list_reset_sort()} onremove={() => onSort('newest')}>
					{msg.mail_list_sorted_by({ sort: SORT_OPTIONS.find((o) => o.id === sort)?.label ?? '' })}
				</Chip>
			{/if}
			{#if activeFilters > 0}
				<Chip size="sm" removeLabel={msg.mail_list_clear_filters()} onremove={clearFilters}>
					{msg.mail_list_filters_active({ count: activeFilters })}
				</Chip>
			{/if}
		</div>
	{/if}
	{#if job}
		<div class="sel-strip job" role="status">
			<span class="lf-spin"></span>
			<span class="sel-text">{job.text}</span>
			{#if onStopJob}
				<button type="button" class="sel-act" disabled={job.stopping} onclick={onStopJob}>
					{msg.mail_job_stop()}
				</button>
			{/if}
		</div>
	{:else if inQuery}
		<div class="sel-strip" role="status">
			<span class="sel-text">
				{msg.mail_selection_all_matching({ count: fmt(querySelected ?? 0), view: viewName })}
			</span>
			{#if onClearSelection}
				<button type="button" class="sel-act" onclick={onClearSelection}>{msg.mail_list_clear_selection()}</button>
			{/if}
		</div>
	{:else if allChecked && matchingTotal !== undefined && checked.size > 0}
		<div class="sel-strip" role="status">
			<span class="sel-text">{msg.mail_selection_loaded_all({ count: checked.size })}</span>
			{#if onSelectMatching}
				<button
					type="button"
					class="sel-act"
					disabled={matchingTotal === null}
					onclick={onSelectMatching}
				>
					{matchingTotal === null
						? msg.mail_selection_counting()
						: msg.mail_selection_select_matching({ count: fmt(matchingTotal), view: viewName })}
				</button>
			{/if}
		</div>
	{:else if searchActive && checked.size > 0}
		<div class="sel-strip" role="status">
			<span class="sel-text">{msg.mail_selection_search_loaded({ count: checked.size })}</span>
		</div>
	{/if}
	<div class="scroll" bind:this={scrollEl} aria-busy={listRefreshing || undefined}>
		{#if pendingCount > 0}
			<button type="button" class="new-strip" onclick={flushPending}>
				<Icon icon={faArrowUp} size={14} />
				<span>{msg.mail_list_new_messages({ count: pendingCount })}</span>
			</button>
		{/if}
		{#if returnedCount > 0}
			<div class="snz-strip">
				<Icon icon={faAlarmClock} size={15} />
				<span>{msg.mail_list_snooze_returned({ count: returnedCount })}</span>
				{#if onDismissReturned}
					<Button
						variant="ghost"
						size="icon-xs"
						class="snz-x"
						tooltip={msg.mail_list_dismiss()}
						onclick={onDismissReturned}
					>
						<Icon icon={faXmark} size={13} />
					</Button>
				{/if}
			</div>
		{/if}
		{#if search && SearchStrip}
			<SearchStrip {search} />
		{/if}
		{#if !searchActive && offline}
			<div class="state-strip" role="status">
				<Icon icon={faWifiSlash} size={14} />
				<span>{msg.mail_list_offline()}</span>
			</div>
		{:else if !searchActive && loaded && loadError}
			<div class="state-strip warn" role="status">
				<Icon icon={faCircleExclamation} size={14} />
				<span>{msg.mail_list_refresh_failed()}</span>
				{#if onRetry}
					<button type="button" class="state-retry" onclick={onRetry}>{msg.common_retry()}</button>
				{/if}
			</div>
		{/if}
		{#if !searchActive && !loaded && loadError}
			<div class="list-state">
				<LoadState kind="error" label={msg.mail_list_load_failed()} {onRetry} />
			</div>
		{:else if !searchActive && (!loaded || firstLoad.visible)}
			{#if firstLoad.visible}
				<ListSkeleton />
			{/if}
		{:else if list.length === 0 && relatedRows.length === 0 && relatedPending}
			<div class="list-state" aria-busy="true"></div>
		{:else if list.length === 0 && relatedRows.length === 0}
			<EmptyState
				class="empty-list"
				icon={search ? faMagnifyingGlass : activeFilters > 0 ? faFilter : faInbox}
				title={emptyTitle}
				description={emptyDetail}
			>
				{#if errorParts}
					<code class="q-err" dir="auto">{errorParts.before}<mark>{errorParts.bad}</mark>{errorParts.after}</code>
				{/if}
				{#snippet action()}
					{#if search && searchEmpty?.finish}
						<Button variant="neutral" size="sm" onclick={finishSearchSetup}>{msg.mail_search_unconverted_action()}</Button>
					{:else if search && searchEmpty?.retry}
						<Button variant="neutral" size="sm" onclick={search.onRetry}><Icon icon={faArrowsRotate} size={14} />{msg.common_retry()}</Button>
					{:else if search}
						<Button variant="neutral" size="sm" onclick={search.onClear}><Icon icon={faXmark} size={14} />{msg.mail_list_clear_search()}</Button>
					{:else if activeFilters > 0}
						<Button variant="neutral" size="sm" onclick={clearFilters}><Icon icon={faXmark} size={14} />{msg.mail_list_clear_filters()}</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			{#each shownGroups as { g, items } (g ?? 'all')}
				{#if g}
					<div class="daygrp"><span class="l">{dayBucketLabel(g)}</span><span class="rule"></span></div>
				{/if}
				{#each items as m (m.id)}
					{@render row(m)}
				{/each}
			{/each}
			{#if allRowsShown}
				{#each relatedRows as m (m.id)}
					{@render row(m)}
				{/each}
			{/if}
			<Tooltip.Shared tether={rowTips} />
		{/if}
		{#if (!searchActive || list.length > 0 || relatedRows.length > 0) && allRowsShown}
			<div class="list-foot" bind:this={sentinelEl}>
				{#if loadMoreError}
					<Button variant="neutral" size="sm" onclick={onLoadMore}>{msg.mail_list_load_more_failed()}</Button>
				{:else if loadingMore}
					<span class="lf-spin"></span><span class="lf-text">{msg.mail_list_loading_more()}</span>
				{:else if exhausted && (list.length > 0 || relatedRows.length > 0) && !offline}
					<span class="lf-hair"></span>
					<span class="lf-text">{msg.mail_list_end()}</span>
					<span class="lf-hair"></span>
				{/if}
			</div>
		{/if}
	</div>
</section>
