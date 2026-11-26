<script lang="ts">
	import Logo from '$core/components/Logo.svelte';
	import { m } from '$paraglide/messages.js';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';
	import * as DropdownMenu from '$core/components/ui/dropdown-menu';
	import * as Popover from '$core/components/ui/popover';
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import {
		faBoxArchive as faBoxArchiveSolid,
		faClock as faClockSolid,
		faEnvelope as faEnvelopeSolid,
		faFileLines as faFileLinesSolid,
		faFolder as faFolderSolid,
		faPaperPlane as faPaperPlaneSolid,
		faPaperPlaneTop as faPaperPlaneTopSolid,
		faShieldExclamation as faShieldExclamationSolid,
		faStar as faStarSolid,
		faTrashCan as faTrashCanSolid
	} from '@fortawesome/pro-solid-svg-icons';
	import StateIcon, { type Gesture } from '$core/components/StateIcon.svelte';
	import Toast from '$core/components/Toast.svelte';
	import RailAccount from './RailAccount.svelte';
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import {
		faBoxArchive,
		faChevronDown,
		faChevronRight,
		faClock,
		faEnvelope,
		faFileLines,
		faFolder,
		faFolderArrowDown,
		faFolderPlus,
		faListDropdown,
		faListTree,
		faMagnifyingGlass,
		faPaperPlane,
		faPaperPlaneTop,
		faPenLine,
		faPlus,
		faShieldExclamation,
		faSliders,
		faStar,
		faStarExclamation,
		faTag,
		faTrashCan
	} from '@fortawesome/pro-regular-svg-icons';
	import { FOLDERS, customFolderId, customLabelId, customFolderRoute, customLabelRoute } from './data';
	import type { CollectionUnread, MailCollectionKind } from '$core/api/types';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { delayed } from '$core/async/delayed.svelte';
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
	import CollectionDialogs from './collections/CollectionDialogs.svelte';
	import CollectionManageItems from './collections/CollectionManageItems.svelte';
	import type { DeletedCollection } from './collections/rules';
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

	const collectionsFailed = $derived(
		mailCollections.loaded && mailCollections.error !== null && mailCollections.nodes.length === 0
	);
	const collectionsReady = $derived(mailCollections.loaded && !collectionsFailed);
	const collectionsWait = delayed(() => !mailCollections.loaded);
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

	type FolderIcon = { icon: IconDefinition; active: IconDefinition; gesture: Gesture };

	const folderIcons: Record<string, FolderIcon> = {
		inbox: { icon: faEnvelope, active: faEnvelopeSolid, gesture: 'drop' },
		starred: { icon: faStar, active: faStarSolid, gesture: 'spin' },
		sent: { icon: faPaperPlane, active: faPaperPlaneSolid, gesture: 'fly' },
		drafts: { icon: faFileLines, active: faFileLinesSolid, gesture: 'tilt' },
		archive: { icon: faBoxArchive, active: faBoxArchiveSolid, gesture: 'drop' },
		snoozed: { icon: faClock, active: faClockSolid, gesture: 'ring' },
		scheduled: { icon: faPaperPlaneTop, active: faPaperPlaneTopSolid, gesture: 'fly-level' },
		spam: { icon: faShieldExclamation, active: faShieldExclamationSolid, gesture: 'pulse' },
		trash: { icon: faTrashCan, active: faTrashCanSolid, gesture: 'shake' }
	};

	const FALLBACK_ICON: FolderIcon = { icon: faFolder, active: faFolderSolid, gesture: 'drop' };

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

	let toast = $state<{ text: string; tone: 'success' | 'error' } | null>(null);
	let toastTimer: ReturnType<typeof setTimeout> | undefined;
	let announcement = $state('');

	function flash(text: string, tone: 'success' | 'error' = 'success') {
		toast = { text, tone };
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
			flash(m.mail_collection_reorder_failed(), 'error');
		}
	}

	function move(entry: CollectionEntry, delta: number) {
		const sibs = siblingsOf(entry);
		const at = sibs.indexOf(entry.id) + delta;
		if (at < 0 || at >= sibs.length) return;
		void reorder(entry, moveAmongSiblings(sibs, entry.id, at));
	}

	function moveAndRefocus(entry: CollectionEntry, delta: number, el: HTMLElement) {
		move(entry, delta);
		void tick().then(() => {
			if (el.isConnected) el.focus();
		});
	}

	async function toggleFavorite(entry: CollectionEntry) {
		try {
			await mailCollections.setFavorite(entry.id, !entry.favorite);
		} catch {
			flash(m.mail_collection_favorite_failed(), 'error');
		}
	}

	async function recolor(entry: CollectionEntry, color: string | null) {
		try {
			await mailCollections.recolor(entry.id, color);
		} catch {
			flash(m.mail_collection_update_failed(), 'error');
		}
	}

	let dialogs = $state<ReturnType<typeof CollectionDialogs>>();
	let handedOff = false;

	function handOff(open: (d: ReturnType<typeof CollectionDialogs>) => void) {
		if (!dialogs) return;
		handedOff = true;
		open(dialogs);
	}

	function deleted({ entry, destination }: DeletedCollection) {
		flash(
			entry.kind === 'folder'
				? m.mail_collection_folder_deleted({ name: entry.name })
				: m.mail_collection_label_deleted({ name: entry.name })
		);
		if (activeCollection !== entry.id) return;
		const target =
			destination?.kind === 'folder' && destination.folderId
				? customFolderRoute(destination.folderId)
				: (destination?.kind ?? 'inbox');
		void goto(`${slotBase}/mail/${target}`);
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
	let createRestore = true;

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

	let rail = $state<HTMLElement>();
	$effect(() => {
		if (!mailNav.open || !window.matchMedia(NARROW).matches) return;
		void tick().then(() => {
			const target =
				rail?.querySelector<HTMLElement>('[aria-current="page"]') ??
				rail?.querySelector<HTMLElement>('.rail-nav a');
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


{#snippet sectionHead(section: MailSidebarSection, title: string, kind?: MailCollectionKind)}
	<div class="fgroup fgroup-sec">
		<button
			type="button"
			class="fg-toggle"
			class:closed={collapsed.has(section)}
			aria-expanded={!collapsed.has(section)}
			onclick={() => toggleSection(section)}
		>
			<Icon icon={faChevronRight} size={12} />
			<span>{title}</span>
		</button>
		{#if kind}
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={kind === 'folder' ? m.mail_collection_new_folder() : m.mail_collection_new_label()}
				title={kind === 'folder' ? m.mail_collection_new_folder() : m.mail_collection_new_label()}
				onclick={(e) => startCreate(kind, null, e.currentTarget)}
			>
				<Icon icon={faPlus} size={14} />
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet collectionsPending()}
	{#if collectionsFailed}
		<div class="rail-state" role="alert">
			<span>{m.mail_sidebar_collections_failed()}</span>
			<button type="button" onclick={() => void mailCollections.load()}>{m.common_retry()}</button>
		</div>
	{:else if collectionsWait.visible}
		<div class="rail-skel" aria-busy="true" aria-label={m.common_loading()}>
			<span></span><span></span>
		</div>
	{/if}
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
	<a class="brand" href="/" aria-label="Thelemail"><Logo /></a>

	<Button variant="primary" block class="compose" onclick={onCompose}>
		<Icon icon={faPenLine} size={17} />{m.mail_sidebar_compose()}
	</Button>

	<nav class="rail-nav" aria-label={m.mail_sidebar_navigation()}>
		<div class="nav-list">
			{#each primary as f (f.id)}
				{@const fi = folderIcons[f.id] ?? FALLBACK_ICON}
				{@const on = activeSystemFolder === f.id}
				{@const c = counts[f.id]}
				{@const isInbox = f.id === 'inbox'}
				<a
					class="fld"
					class:active={on}
					class:unread={isInbox && c}
					href={`${slotBase}/mail/${f.id}`}
					aria-current={on ? 'page' : undefined}
					onclick={closeNav}
				>
					<StateIcon icon={fi.icon} activeIcon={fi.active} active={on} gesture={fi.gesture} size={16} />
					<span class="lbl">{f.label}</span>
					{#if c}<span class="ct">{c}</span>{/if}
				</a>
			{/each}
			{#if showMore}
				{#each secondary as f (f.id)}
					{@const fi = folderIcons[f.id] ?? FALLBACK_ICON}
					{@const on = activeSystemFolder === f.id}
					{@const c = counts[f.id]}
					<a
						class="fld"
						class:active={on}
						href={`${slotBase}/mail/${f.id}`}
						aria-current={on ? 'page' : undefined}
						onclick={closeNav}
					>
						<StateIcon icon={fi.icon} activeIcon={fi.active} active={on} gesture={fi.gesture} size={16} />
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
				<Icon icon={faChevronDown} size={16} class="more-chev" />
				<span class="lbl">{showMore ? m.mail_sidebar_less() : m.mail_sidebar_more()}</span>
			</button>
		</div>

		{#if showFilter}
			<label class="rail-find">
				<Icon icon={faMagnifyingGlass} size={14} />
				<input
					type="search"
					bind:value={query}
					placeholder={m.mail_sidebar_find()}
					aria-label={m.mail_sidebar_find()}
					onkeydown={onFilterKeydown}
				/>
			</label>
		{/if}

		<div class="rail-scroll">
			{#if favorites.length > 0 && !filtering}
				{@render sectionHead('favorites', m.mail_sidebar_favorites())}
				{#if !collapsed.has('favorites')}
					{@render tree(m.mail_sidebar_favorites(), favorites, allCustom, true)}
				{/if}
			{/if}

			{#if !filtering || shownFolders.length > 0}
				{@render sectionHead('folders', m.mail_collection_folders(), 'folder')}
				{#if !collapsed.has('folders') || filtering}
					{#if collectionsReady}
						{@render tree(m.mail_collection_folders(), shownFolders, customFolders, false)}
					{:else}
						{@render collectionsPending()}
					{/if}
				{/if}
			{/if}

			{#if !filtering || shownLabels.length > 0}
				{@render sectionHead('labels', m.mail_collection_labels(), 'label')}
				{#if !collapsed.has('labels') || filtering}
					{#if collectionsReady}
						{@render tree(m.mail_collection_labels(), shownLabels, customLabels, false)}
					{:else}
						{@render collectionsPending()}
					{/if}
				{/if}
			{/if}

			{#if filtering && shownFolders.length === 0 && shownLabels.length === 0}
				<p class="rail-find-empty">{m.mail_sidebar_find_empty()}</p>
			{/if}
		</div>
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
		<DropdownMenu.Content
				class="coll-menu"
				portalProps={{ to: '.mail-app' }}
				customAnchor={menuAnchor}
				side="bottom"
				align="start"
				sideOffset={4}
				collisionPadding={12}
				onCloseAutoFocus={(ev) => {
					ev.preventDefault();
					if (handedOff) {
						handedOff = false;
						return;
					}
					if (!creating && returnTo.isConnected) returnTo.focus();
				}}
			>
				<DropdownMenu.Label class="coll-menu-title" title={e.path}>{e.path}</DropdownMenu.Label>
				{#if menuHasKids}
					<DropdownMenu.Item
						onSelect={() => {
							closeNav();
							void goto(`${slotBase}/mail/${routeOf(e)}?scope=direct`);
						}}
					>
						<Icon icon={faFolderArrowDown} />{e.kind === 'folder' ? m.mail_view_only_folder() : m.mail_view_only_label()}
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Item onSelect={() => void toggleFavorite(e)}>
					{#if e.favorite}
						<Icon icon={faStarExclamation} />{m.mail_sidebar_remove_favorite()}
					{:else}
						<Icon icon={faStar} />{m.mail_sidebar_add_favorite()}
					{/if}
				</DropdownMenu.Item>
				{#if e.depth < MAX_CREATE_DEPTH}
					<DropdownMenu.Item onSelect={() => startCreate(e.kind, e.id, returnTo)}>
						{#if e.kind === 'folder'}
							<Icon icon={faFolderPlus} />{m.mail_sidebar_new_subfolder()}
						{:else}
							<Icon icon={faTag} />{m.mail_sidebar_new_sublabel()}
						{/if}
					</DropdownMenu.Item>
				{/if}
				{#if menuHasKids}
					<DropdownMenu.Item onSelect={() => setExpanded(parentIdsIn(e), true)}>
						<Icon icon={faListTree} />{m.mail_sidebar_expand_all()}
					</DropdownMenu.Item>
					<DropdownMenu.Item onSelect={() => setExpanded(parentIdsIn(e), false)}>
						<Icon icon={faListDropdown} />{m.mail_sidebar_collapse_all()}
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Separator />
				<CollectionManageItems
					entry={e}
					index={menuIndex}
					siblings={menuSibs.length}
					onEdit={() => handOff((d) => d.edit(e, returnTo))}
					onRecolor={(color) => void recolor(e, color)}
					onMove={() => handOff((d) => d.move(e, returnTo))}
					onShift={(delta) => moveAndRefocus(e, delta, returnTo)}
					onDelete={() => handOff((d) => d.remove(e, returnTo))}
				/>
				<DropdownMenu.Separator />
				<DropdownMenu.Item
					onSelect={() => {
						closeNav();
						void goto(`${slotBase}/settings/collections`);
					}}
				>
					<Icon icon={faSliders} />{m.mail_collection_manage()}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
	{/if}
</DropdownMenu.Root>

{#if creating}
	{@const c = creating}
	{@const createLabel = c.parent
		? c.kind === 'folder'
			? m.mail_sidebar_new_subfolder()
			: m.mail_sidebar_new_sublabel()
		: c.kind === 'folder'
			? m.mail_collection_new_folder()
			: m.mail_collection_new_label()}
	<Popover.Root
		bind:open={
			() => true,
			(next) => {
				if (!next) closeCreate(createRestore);
			}
		}
	>
		<Popover.Content
			class="coll-create"
			customAnchor={c.anchor}
			side="bottom"
			align="start"
			collisionPadding={12}
			aria-label={createLabel}
			portalProps={{ to: '.mail-app' }}
			onEscapeKeydown={() => (createRestore = true)}
			onInteractOutside={() => (createRestore = false)}
			onCloseAutoFocus={(ev) => ev.preventDefault()}
		>
			<p class="popover-label">{createLabel}</p>
			<CollectionCreate kind={c.kind} parent={c.parent} onCreated={created} />
		</Popover.Content>
	</Popover.Root>
{/if}

<CollectionDialogs bind:this={dialogs} onDeleted={deleted} />

{#if toast}
	<Toast text={toast.text} tone={toast.tone} />
{/if}
