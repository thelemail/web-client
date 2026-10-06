<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { tick } from 'svelte';
	import { DropdownMenu } from 'bits-ui';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import TagIcon from '@lucide/svelte/icons/tag';
	import Plus from '@lucide/svelte/icons/plus';
	import Lock from '@lucide/svelte/icons/lock';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import StarIcon from '@lucide/svelte/icons/star';
	import StarOff from '@lucide/svelte/icons/star-off';
	import FolderPlus from '@lucide/svelte/icons/folder-plus';
	import SecHead from '../SecHead.svelte';
	import CardHead from '../CardHead.svelte';
	import { Button } from '$core/components/ui/button';
	import type { MailCollectionKind } from '$core/api/types';
	import { auth } from '$core/stores/auth.svelte';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import CollectionCreate from '$core/mail/collections/CollectionCreate.svelte';
	import CollectionDialogs from '$core/mail/collections/CollectionDialogs.svelte';
	import CollectionManageItems from '$core/mail/collections/CollectionManageItems.svelte';
	import { collectionColor } from '$core/mail/collections/palette';
	import { ambiguousNames, collectionErrorText, foldName, MAX_COLLECTION_DEPTH } from '$core/mail/collections/rules';
	import { moveAmongSiblings, siblingIds, type CollectionEntry } from '$core/mail/collections/tree';
	import '$core/mail/collections/collections.css';

	$effect(() => {
		if (auth.accountId) void mailCollections.ready();
	});

	const ambiguous = $derived(ambiguousNames([...mailCollections.folders, ...mailCollections.labels]));

	let creating = $state<{ kind: MailCollectionKind; parent: string | null; key: number } | null>(null);
	let createSeq = 0;
	let status = $state('');
	let error = $state<string | null>(null);

	function startCreate(kind: MailCollectionKind, parent: string | null) {
		creating = { kind, parent, key: ++createSeq };
	}

	function created(entry: CollectionEntry) {
		creating = null;
		void tick().then(() =>
			document.querySelector<HTMLElement>(`[data-collection="${entry.id}"] .rowmenu`)?.focus()
		);
		status = entry.kind === 'folder'
			? m.settings_collections_folder_created({ path: entry.path })
			: m.settings_collections_label_created({ path: entry.path });
	}

	async function run(entry: CollectionEntry, action: () => Promise<void>) {
		error = null;
		try {
			await action();
		} catch (err) {
			error = collectionErrorText(err, entry.kind, m.mail_collection_update_failed());
		}
	}

	function all(kind: MailCollectionKind): CollectionEntry[] {
		return kind === 'folder' ? mailCollections.folders : mailCollections.labels;
	}

	function shift(entry: CollectionEntry, delta: number, returnTo: HTMLElement) {
		const sibs = siblingIds(all(entry.kind), entry.id);
		const at = sibs.indexOf(entry.id) + delta;
		if (at < 0 || at >= sibs.length) return;
		const order = moveAmongSiblings(sibs, entry.id, at);
		void run(entry, async () => {
			await mailCollections.reorder(entry.kind, entry.parentId ?? null, order);
			status = m.mail_sidebar_moved({ name: entry.name, position: at + 1, total: sibs.length });
		});
		requestAnimationFrame(() => {
			if (returnTo.isConnected) returnTo.focus();
		});
	}

	let dialogs = $state<ReturnType<typeof CollectionDialogs>>();
	let menu = $state<{ id: string; anchor: HTMLElement } | null>(null);
	let handedOff = false;

	const menuEntry = $derived(menu ? mailCollections.byId(menu.id) : undefined);
	const menuSibs = $derived(menuEntry ? siblingIds(all(menuEntry.kind), menuEntry.id) : []);

	function handOff(open: (d: ReturnType<typeof CollectionDialogs>) => void) {
		if (!dialogs) return;
		handedOff = true;
		open(dialogs);
	}
</script>

<SecHead desc={m.settings_collections_desc()} />

{#if error}
	<div class="coll-set-err" role="alert">{error}</div>
{/if}

{#snippet card(kind: MailCollectionKind)}
	{@const entries = all(kind)}
	{@const folder = kind === 'folder'}
	<div class="scard">
		<CardHead icon={folder ? FolderIcon : TagIcon} title={folder ? m.mail_collection_folders() : m.mail_collection_labels()}>
			{#snippet right()}
				<span class="card-meta">
					{folder
						? m.settings_collections_folder_count({ count: entries.length })
						: m.settings_collections_label_count({ count: entries.length })}
				</span>
			{/snippet}
		</CardHead>

		{#if !mailCollections.loaded}
			<div class="coll-set-empty">{m.common_loading()}</div>
		{:else if entries.length === 0}
			<div class="coll-set-empty">
				{folder ? m.settings_collections_no_folders() : m.settings_collections_no_labels()}
			</div>
		{/if}

		<ul class="coll-set-list" aria-label={folder ? m.mail_collection_folders() : m.mail_collection_labels()}>
			{#each entries as e (e.id)}
				<li class="coll-set-row" class:sealed={e.sealed} data-collection={e.id} style:--depth={Math.min(e.depth, 8)}>
					<span class="coll-set-ico" style:color={e.color ? collectionColor(e.color) : undefined} aria-hidden="true">
						{#if folder}<FolderIcon size={16} />{:else}<TagIcon size={16} />{/if}
					</span>
					<div class="coll-set-info">
						<div class="coll-set-name">
							<span>{e.name}</span>
							{#if e.favorite}
								<StarIcon size={12} class="coll-set-fav" aria-label={m.mail_sidebar_favorites()} />
							{/if}
						</div>
						{#if e.depth > 0 && ambiguous.has(foldName(e.name))}
							<div class="coll-set-path">{e.path}</div>
						{/if}
					</div>
					{#if e.sealed}
						<span class="coll-set-locked" title={m.settings_collections_locked_row()}><Lock size={14} /></span>
					{:else}
						<button
							type="button"
							class="rowmenu"
							aria-label={m.mail_sidebar_actions({ name: e.path })}
							aria-haspopup="menu"
							aria-expanded={menu?.id === e.id}
							onclick={(ev) => (menu = { id: e.id, anchor: ev.currentTarget })}
						>
							<Ellipsis size={16} />
						</button>
					{/if}
				</li>
			{/each}
		</ul>

		{#if creating?.kind === kind}
			{@const c = creating}
			<div class="coll-set-create">
				{#key c.key}
					<CollectionCreate kind={c.kind} parent={c.parent} onCreated={created} />
				{/key}
				<Button variant="ghost" size="sm" onclick={() => (creating = null)}>{m.common_cancel()}</Button>
			</div>
		{:else}
			<button type="button" class="addrow" onclick={() => startCreate(kind, null)}>
				<Plus size={16} />{folder ? m.mail_collection_new_folder() : m.mail_collection_new_label()}
			</button>
		{/if}
	</div>
{/snippet}

{#if mailCollections.locked}
	<div class="coll-set-note"><Lock size={13} /><span>{m.settings_collections_locked_note()}</span></div>
{/if}

{@render card('folder')}
{@render card('label')}

<div class="coll-set-live" aria-live="polite">{status}</div>

<DropdownMenu.Root
	open={!!menu}
	onOpenChange={(open) => {
		if (!open) menu = null;
	}}
>
	{#if menu && menuEntry}
		{@const e = menuEntry}
		{@const returnTo = menu.anchor}
		<DropdownMenu.Portal to=".settings-app">
			<DropdownMenu.Content
				class="coll-set-menu"
				customAnchor={returnTo}
				side="bottom"
				align="end"
				sideOffset={4}
				collisionPadding={12}
				onCloseAutoFocus={(ev) => {
					ev.preventDefault();
					if (handedOff) {
						handedOff = false;
						return;
					}
					if (returnTo.isConnected) returnTo.focus();
				}}
			>
				<div class="coll-set-menu-title" title={e.path}>{e.path}</div>
				<DropdownMenu.Item class="mitem" onSelect={() => void run(e, () => mailCollections.setFavorite(e.id, !e.favorite))}>
					{#if e.favorite}
						<StarOff />{m.mail_sidebar_remove_favorite()}
					{:else}
						<StarIcon />{m.mail_sidebar_add_favorite()}
					{/if}
				</DropdownMenu.Item>
				{#if e.depth + 1 < MAX_COLLECTION_DEPTH}
					<DropdownMenu.Item
						class="mitem"
						onSelect={() => {
							handedOff = true;
							startCreate(e.kind, e.id);
						}}
					>
						{#if e.kind === 'folder'}
							<FolderPlus />{m.mail_sidebar_new_subfolder()}
						{:else}
							<TagIcon />{m.mail_sidebar_new_sublabel()}
						{/if}
					</DropdownMenu.Item>
				{/if}
				<DropdownMenu.Separator class="msep" />
				<CollectionManageItems
					entry={e}
					index={menuSibs.indexOf(e.id)}
					siblings={menuSibs.length}
					onEdit={() => handOff((d) => d.edit(e, returnTo))}
					onRecolor={(color) => void run(e, () => mailCollections.recolor(e.id, color))}
					onMove={() => handOff((d) => d.move(e, returnTo))}
					onShift={(delta) => shift(e, delta, returnTo)}
					onDelete={() => handOff((d) => d.remove(e, returnTo))}
				/>
			</DropdownMenu.Content>
		</DropdownMenu.Portal>
	{/if}
</DropdownMenu.Root>

<CollectionDialogs
	bind:this={dialogs}
	onDeleted={({ entry }) =>
		(status =
			entry.kind === 'folder'
				? m.mail_collection_folder_deleted({ name: entry.name })
				: m.mail_collection_label_deleted({ name: entry.name }))}
/>
