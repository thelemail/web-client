<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { DropdownMenu } from 'bits-ui';
	import {
		AlarmClock,
		Archive,
		ArchiveRestore,
		ChevronDown,
		ChevronUp,
		Clock,
		FilePen,
		FileText,
		Folder,
		Mail,
		MailOpen,
		Send,
		SendHorizontal,
		ShieldAlert,
		ShieldX,
		Star,
		Timer,
		Trash,
		Trash2,
		type IconNode
	} from 'lucide';
	import NavMorph from '$core/components/NavMorph.svelte';
	import AnchoredMenu from '$core/components/AnchoredMenu.svelte';
	import Toast from '$core/components/Toast.svelte';
	import RailSearch from './RailSearch.svelte';
	import RailAccount from './RailAccount.svelte';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import StarIcon from '@lucide/svelte/icons/star';
	import StarOff from '@lucide/svelte/icons/star-off';
	import FolderPlus from '@lucide/svelte/icons/folder-plus';
	import TagIcon from '@lucide/svelte/icons/tag';
	import FolderInput from '@lucide/svelte/icons/folder-input';
	import ListTree from '@lucide/svelte/icons/list-tree';
	import ListCollapse from '@lucide/svelte/icons/list-collapse';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Search from '@lucide/svelte/icons/search';
	import { FOLDERS, customFolderId, customLabelId, customFolderRoute, customLabelRoute } from './data';
	import type { CollectionUnread, MailCollectionKind } from '$core/api/types';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { accountSettings, type MailSidebarSection } from '$core/stores/accountSettings.svelte';
	import { billing } from '$core/stores/billing.svelte';
	import { mailNav } from '$core/stores/nav.svelte';
	import {
		ancestorIds,
		filterEntries,
		moveAmongSiblings,
		siblingIds,
		subtreeIds,
		type CollectionEntry
	} from './collections/tree';
	import CollectionCreate from './collections/CollectionCreate.svelte';
	import CollectionTree, { type MenuAnchor } from './sidebar/CollectionTree.svelte';

	function closeNav() {
		mailNav.close();
	}

	interface Counts {
		inbox: number;
		starred: number;
		drafts: number;
		spam: number;
		snoozed: number;
		scheduled: number;
		[k: string]: number | undefined;
	}

	interface Props {
		counts: Counts;
		folderCounts?: Record<string, CollectionUnread>;
		labelCounts?: Record<string, CollectionUnread>;
		onCompose: () => void;
	}

	let { counts, folderCounts = {}, labelCounts = {}, onCompose }: Props = $props();

	const FILTER_THRESHOLD = 12;
	const MAX_CREATE_DEPTH = 15;
	const NARROW = '(max-width: 1000px)';

	function withoutSealed(entries: CollectionEntry[]): CollectionEntry[] {
		const out: CollectionEntry[] = [];
		let hiddenBelow = Infinity;
		for (const e of entries) {
			if (e.depth > hiddenBelow) continue;
			hiddenBelow = Infinity;
			if (e.sealed) {
				hiddenBelow = e.depth;
				continue;
			}
			out.push(e);
		}
		return out;
	}

	const customFolders = $derived(withoutSealed(mailCollections.folders));
	const customLabels = $derived(withoutSealed(mailCollections.labels));
	const favorites = $derived(mailCollections.favorites);
	const allCustom = $derived([...customFolders, ...customLabels]);
	const allCounts = $derived({ ...labelCounts, ...folderCounts });

	const prefs = $derived(accountSettings.mailSidebar);
	const showMore = $derived(prefs.showMore);
	const collapsed = $derived(new Set<MailSidebarSection>(prefs.collapsed));

	let query = $state('');
	const filtering = $derived(query.trim().length > 0);
	const showFilter = $derived(allCustom.length > FILTER_THRESHOLD || filtering);
	const shownFolders = $derived(filtering ? filterEntries(customFolders, query) : customFolders);
	const shownLabels = $derived(filtering ? filterEntries(customLabels, query) : customLabels);

	const slot = $derived(page.params.slot ?? '0');
	const slotBase = $derived(`/u/${slot}`);

	const folderIcons: Record<string, [IconNode, IconNode]> = {
		inbox: [Mail, MailOpen],
		starred: [Star, Star],
		sent: [Send, SendHorizontal],
		drafts: [FileText, FilePen],
		archive: [Archive, ArchiveRestore],
		snoozed: [Clock, AlarmClock],
		scheduled: [SendHorizontal, Timer],
		spam: [ShieldAlert, ShieldX],
		trash: [Trash2, Trash]
	};

	const FALLBACK_ICONS: [IconNode, IconNode] = [Folder, Folder];

	const primary = $derived(FOLDERS.filter((f) => !f.more));
	const secondary = $derived(FOLDERS.filter((f) => f.more));

	const activeSystemFolder = $derived(page.params.folder ?? null);
	const activeCollection = $derived(
		activeSystemFolder
			? (customFolderId(activeSystemFolder) ?? customLabelId(activeSystemFolder))
			: null
	);

	const activePath = $derived(
		activeCollection ? ancestorIds(allCustom, activeCollection).join('/') : ''
	);
	let revealed = $derived<ReadonlySet<string>>(new Set(activePath ? activePath.split('/') : []));

	const expanded = $derived(new Set([...prefs.expanded, ...revealed]));

	function persist(patch: Partial<typeof prefs>) {
		const next = { ...prefs, ...patch };
		if (mailCollections.loaded) {
			const live = new Set(mailCollections.nodes.map((n) => n.id));
			next.expanded = next.expanded.filter((id) => live.has(id));
		}
		accountSettings.persistMailSidebar(next);
	}

	function setExpanded(ids: string[], open: boolean) {
		const next = new Set(expanded);
		for (const id of ids) {
			if (open) next.add(id);
			else next.delete(id);
		}
		if (!open) revealed = new Set([...revealed].filter((id) => !ids.includes(id)));
		persist({ expanded: [...next] });
	}

	function toggleSection(section: MailSidebarSection) {
		const next = new Set(collapsed);
		if (next.has(section)) next.delete(section);
		else next.add(section);
		persist({ collapsed: [...next] });
	}

	let toast = $state<string | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let announcement = $state('');

	function flash(text: string) {
		toast = text;
		announcement = text;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 2600);
	}

	function siblingsOf(entry: CollectionEntry): string[] {
		return siblingIds(entry.kind === 'folder' ? customFolders : customLabels, entry.id);
	}

	async function reorder(entry: CollectionEntry, order: string[]) {
		try {
			await mailCollections.reorder(entry.kind, entry.parentId ?? null, order);
			announcement = m.mail_sidebar_moved({
				name: entry.name,
				position: order.indexOf(entry.id) + 1,
				total: order.length
			});
		} catch {
			flash(m.mail_collection_reorder_failed());
		}
	}

	function move(entry: CollectionEntry, delta: number) {
		const sibs = siblingsOf(entry);
		const at = sibs.indexOf(entry.id) + delta;
		if (at < 0 || at >= sibs.length) return;
		void reorder(entry, moveAmongSiblings(sibs, entry.id, at));
	}

	async function toggleFavorite(entry: CollectionEntry) {
		try {
			await mailCollections.setFavorite(entry.id, !entry.favorite);
		} catch {
			flash(m.mail_collection_favorite_failed());
		}
	}

	type MenuState = { entry: CollectionEntry; anchor: MenuAnchor; returnTo: HTMLElement };
	let menu = $state<MenuState | null>(null);

	const menuAnchor = $derived.by(() => {
		const a = menu?.anchor;
		if (!a) return null;
		if (a instanceof HTMLElement) return a;
		return { getBoundingClientRect: () => DOMRect.fromRect({ x: a.x, y: a.y, width: 0, height: 0 }) };
	});

	function openMenu(entry: CollectionEntry, anchor: MenuAnchor, returnTo: HTMLElement) {
		menu = { entry, anchor, returnTo };
	}

	const menuEntry = $derived(menu ? (mailCollections.byId(menu.entry.id) ?? menu.entry) : null);
	const menuSibs = $derived(menuEntry ? siblingsOf(menuEntry) : []);
	const menuIndex = $derived(menuEntry ? menuSibs.indexOf(menuEntry.id) : -1);
	const menuHasKids = $derived(!!menuEntry && mailCollections.hasChildren(menuEntry.id));

	function routeOf(e: CollectionEntry): string {
		return e.kind === 'folder' ? customFolderRoute(e.id) : customLabelRoute(e.id);
	}

	function parentIdsIn(entry: CollectionEntry): string[] {
		return subtreeIds(mailCollections.nodes, entry.id).filter((id) => mailCollections.hasChildren(id));
	}

	type CreateState = { kind: MailCollectionKind; parent: string | null; anchor: HTMLElement };
	let creating = $state<CreateState | null>(null);
	let createPanel = $state<HTMLDivElement>();

	function startCreate(kind: MailCollectionKind, parent: string | null, anchor: HTMLElement) {
		creating = { kind, parent, anchor };
	}

	function closeCreate(restore = true) {
		const anchor = creating?.anchor;
		creating = null;
		if (restore && anchor?.isConnected) anchor.focus();
	}

	function created(entry: CollectionEntry) {
		const parent = creating?.parent ?? null;
		closeCreate();
		if (parent) setExpanded([parent], true);
		announcement = entry.path;
	}

	function onCreateKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		closeCreate();
	}

	function onWindowPointerDown(e: PointerEvent) {
		if (!creating) return;
		const t = e.target as Node;
		if (createPanel?.contains(t) || creating.anchor.contains(t)) return;
		closeCreate(false);
	}

	let rail = $state<HTMLElement>();
	$effect(() => {
		if (!mailNav.open || !window.matchMedia(NARROW).matches) return;
		void tick().then(() => {
			const target =
				rail?.querySelector<HTMLElement>('[aria-current="page"]') ??
				rail?.querySelector<HTMLElement>('.rail-scroll a');
			target?.focus({ preventScroll: false });
		});
	});

	function onFilterKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && query) {
			e.preventDefault();
			e.stopPropagation();
			query = '';
		}
		if (e.key === 'ArrowDown') {
			const first = rail?.querySelector<HTMLElement>('.ctree a[tabindex="0"]');
			if (first) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	const storageUsed = $derived(billing.subscription?.storageBytesUsed ?? 0);
	const storageLimit = $derived(billing.subscription?.storageBytesLimit ?? 0);
	const storagePct = $derived(storageLimit > 0 ? Math.min(100, (storageUsed / storageLimit) * 100) : 0);

	function fmtStorage(bytes: number): string {
		if (bytes <= 0) return m.mail_size_mb({ size: 0 });
		const gib = bytes / 2 ** 30;
		if (gib < 1) return m.mail_size_mb({ size: Math.max(1, Math.round(bytes / 2 ** 20)) });
		return m.mail_size_gb({ size: gib.toFixed(1).replace(/\.0$/, '') });
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#snippet sectionHead(section: MailSidebarSection, title: string, kind?: MailCollectionKind)}
	<div class="fgroup fgroup-sec">
		<button
			type="button"
			class="fg-toggle"
			class:closed={collapsed.has(section)}
			aria-expanded={!collapsed.has(section)}
			onclick={() => toggleSection(section)}
		>
			<ChevronRight size={12} />
			<span>{title}</span>
		</button>
		{#if kind}
			<button
				type="button"
				class="addbtn"
				aria-label={kind === 'folder' ? m.mail_collection_new_folder() : m.mail_collection_new_label()}
				title={kind === 'folder' ? m.mail_collection_new_folder() : m.mail_collection_new_label()}
				onclick={(e) => startCreate(kind, null, e.currentTarget)}
			>
				<Plus size={14} />
			</button>
		{/if}
	</div>
{/snippet}

{#snippet tree(label: string, entries: CollectionEntry[], all: CollectionEntry[], flat: boolean)}
	<CollectionTree
		{label}
		{entries}
		{all}
		{flat}
		{filtering}
		{expanded}
		counts={allCounts}
		activeRoute={activeSystemFolder}
		{slotBase}
		menuFor={menu?.entry.id ?? null}
		onToggle={(id, open) => setExpanded([id], open)}
		onExpandSiblings={(ids) => setExpanded(ids, true)}
		onMenu={openMenu}
		onMove={move}
		onReorder={(entry, order) => void reorder(entry, order)}
		onNavigate={closeNav}
	/>
{/snippet}

<aside class="rail" bind:this={rail} aria-label={m.mail_sidebar_navigation()}>
	<a class="brand" href="/" aria-label="Thelemail"><span class="wm">Thelemail</span></a>

	<button class="compose" onclick={onCompose}>
		<PenLine size={17} />{m.mail_sidebar_compose()}
	</button>

	<RailSearch />

	<nav class="rail-scroll" aria-label={m.mail_sidebar_navigation()}>
		<div class="fgroup">{m.mail_sidebar_mailbox()}</div>
		<div class="nav-list">
			{#each primary as f (f.id)}
				{@const pair = folderIcons[f.id] ?? FALLBACK_ICONS}
				{@const on = activeSystemFolder === f.id}
				{@const c = counts[f.id]}
				{@const isInbox = f.id === 'inbox'}
				<a
					class="fld"
					class:active={on}
					class:solid={f.id === 'starred'}
					class:unread={isInbox && c}
					href={`${slotBase}/mail/${f.id}`}
					aria-current={on ? 'page' : undefined}
					onclick={closeNav}
				>
					<NavMorph icon={on ? pair[1] : pair[0]} />
					<span class="lbl">{f.label}</span>
					{#if c}<span class="ct">{c}</span>{/if}
				</a>
			{/each}
			{#if showMore}
				{#each secondary as f (f.id)}
					{@const pair = folderIcons[f.id] ?? FALLBACK_ICONS}
					{@const on = activeSystemFolder === f.id}
					{@const c = counts[f.id]}
					<a
						class="fld"
						class:active={on}
						href={`${slotBase}/mail/${f.id}`}
						aria-current={on ? 'page' : undefined}
						onclick={closeNav}
					>
						<NavMorph icon={on ? pair[1] : pair[0]} />
						<span class="lbl">{f.label}</span>
						{#if c}<span class="ct">{c}</span>{/if}
					</a>
				{/each}
			{/if}
			<button
				type="button"
				class="fld more-toggle"
				aria-expanded={showMore}
				onclick={() => persist({ showMore: !showMore })}
			>
				<NavMorph icon={showMore ? ChevronUp : ChevronDown} />
				<span class="lbl">{showMore ? m.mail_sidebar_less() : m.mail_sidebar_more()}</span>
			</button>
		</div>

		{#if favorites.length > 0 && !filtering}
			{@render sectionHead('favorites', m.mail_sidebar_favorites())}
			{#if !collapsed.has('favorites')}
				{@render tree(m.mail_sidebar_favorites(), favorites, allCustom, true)}
			{/if}
		{/if}

		{#if showFilter}
			<label class="rail-find">
				<Search size={14} />
				<input
					type="search"
					bind:value={query}
					placeholder={m.mail_sidebar_find()}
					aria-label={m.mail_sidebar_find()}
					onkeydown={onFilterKeydown}
				/>
			</label>
		{/if}

		{#if !filtering || shownFolders.length > 0}
			{@render sectionHead('folders', m.mail_collection_folders(), 'folder')}
			{#if !collapsed.has('folders') || filtering}
				{@render tree(m.mail_collection_folders(), shownFolders, customFolders, false)}
			{/if}
		{/if}

		{#if !filtering || shownLabels.length > 0}
			{@render sectionHead('labels', m.mail_collection_labels(), 'label')}
			{#if !collapsed.has('labels') || filtering}
				{@render tree(m.mail_collection_labels(), shownLabels, customLabels, false)}
			{/if}
		{/if}

		{#if filtering && shownFolders.length === 0 && shownLabels.length === 0}
			<p class="rail-find-empty">{m.mail_sidebar_find_empty()}</p>
		{/if}
	</nav>

	{#if storageLimit > 0}
		<div class="storage">
			<div class="srow"><span>{m.mail_sidebar_storage()}</span><span><b>{fmtStorage(storageUsed)}</b> / {fmtStorage(storageLimit)}</span></div>
			<div class="meter"><i style:width={`${storagePct}%`}></i></div>
		</div>
	{/if}

	<RailAccount />

	<div class="rail-live" aria-live="polite">{announcement}</div>
</aside>

<DropdownMenu.Root
	open={!!menu}
	onOpenChange={(open) => {
		if (!open) menu = null;
	}}
>
	{#if menu && menuEntry && menuAnchor}
		{@const e = menuEntry}
		{@const returnTo = menu.returnTo}
		<DropdownMenu.Portal to=".mail-app">
			<DropdownMenu.Content
				class="menu menu-portal coll-menu"
				customAnchor={menuAnchor}
				side="bottom"
				align="start"
				sideOffset={4}
				collisionPadding={12}
				onCloseAutoFocus={(ev) => {
					ev.preventDefault();
					if (!creating && returnTo.isConnected) returnTo.focus();
				}}
			>
				<div class="menu-lbl coll-menu-title" title={e.path}>{e.path}</div>
				{#if menuHasKids}
					<DropdownMenu.Item
						class="mitem"
						onSelect={() => {
							closeNav();
							void goto(`${slotBase}/mail/${routeOf(e)}?scope=direct`);
						}}
					>
						<FolderInput />{e.kind === 'folder' ? m.mail_view_only_folder() : m.mail_view_only_label()}
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Item class="mitem" onSelect={() => void toggleFavorite(e)}>
					{#if e.favorite}
						<StarOff />{m.mail_sidebar_remove_favorite()}
					{:else}
						<StarIcon />{m.mail_sidebar_add_favorite()}
					{/if}
				</DropdownMenu.Item>
				{#if e.depth < MAX_CREATE_DEPTH}
					<DropdownMenu.Item class="mitem" onSelect={() => startCreate(e.kind, e.id, returnTo)}>
						{#if e.kind === 'folder'}
							<FolderPlus />{m.mail_sidebar_new_subfolder()}
						{:else}
							<TagIcon />{m.mail_sidebar_new_sublabel()}
						{/if}
					</DropdownMenu.Item>
				{/if}
				{#if menuHasKids}
					<DropdownMenu.Item class="mitem" onSelect={() => setExpanded(parentIdsIn(e), true)}>
						<ListTree />{m.mail_sidebar_expand_all()}
					</DropdownMenu.Item>
					<DropdownMenu.Item class="mitem" onSelect={() => setExpanded(parentIdsIn(e), false)}>
						<ListCollapse />{m.mail_sidebar_collapse_all()}
					</DropdownMenu.Item>
				{/if}
				{#if menuSibs.length > 1}
					<DropdownMenu.Separator class="msep" />
					<DropdownMenu.Item class="mitem" disabled={menuIndex <= 0} onSelect={() => move(e, -1)}>
						<ArrowUp />{m.mail_sidebar_move_up()}
					</DropdownMenu.Item>
					<DropdownMenu.Item
						class="mitem"
						disabled={menuIndex < 0 || menuIndex >= menuSibs.length - 1}
						onSelect={() => move(e, 1)}
					>
						<ArrowDown />{m.mail_sidebar_move_down()}
					</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	{/if}
</DropdownMenu.Root>

{#if creating}
	{@const c = creating}
	<AnchoredMenu
		anchor={c.anchor}
		bind:panel={createPanel}
		role="dialog"
		label={c.kind === 'folder' ? m.mail_collection_new_folder() : m.mail_collection_new_label()}
		extraClass="coll-create"
	>
		<div onkeydown={onCreateKeydown} role="presentation">
			<div class="menu-lbl">
				{#if c.parent}
					{c.kind === 'folder' ? m.mail_sidebar_new_subfolder() : m.mail_sidebar_new_sublabel()}
				{:else}
					{c.kind === 'folder' ? m.mail_collection_new_folder() : m.mail_collection_new_label()}
				{/if}
			</div>
			<CollectionCreate kind={c.kind} parent={c.parent} onCreated={created} />
		</div>
	</AnchoredMenu>
{/if}

{#if toast}
	<Toast text={toast} />
{/if}
