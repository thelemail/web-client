<script lang="ts" module>
	import type Inbox from '@lucide/svelte/icons/inbox';

	export type SystemTargetId = 'inbox' | 'archive' | 'spam' | 'trash';

	export interface SystemTarget {
		id: SystemTargetId;
		label: string;
		icon: typeof Inbox;
	}
</script>

<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import { mailCollections } from '$core/stores/mailCollections.svelte';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import CollectionPicker from './collections/CollectionPicker.svelte';
	import { collectionColor } from './collections/palette';
	import { hasExactName, searchEntries, type PickerRow, type PickerSection } from './collections/picker';
	import type { CollectionEntry } from './collections/tree';

	interface Props {
		anchor: HTMLElement | undefined;
		systemTargets: SystemTarget[];
		currentFolders: ReadonlySet<string>;
		onSystem: (id: SystemTargetId) => void;
		onFolder: (folderId: string) => void;
		onLabelArchive?: (labelId: string) => void;
		onClose: () => void;
	}

	let { anchor, systemTargets, currentFolders, onSystem, onFolder, onLabelArchive, onClose }: Props =
		$props();

	const RECENT_LIMIT = 5;

	let query = $state('');

	const folders = $derived(mailCollections.folders.filter((f) => !f.sealed && !currentFolders.has(f.id)));
	const labels = $derived(mailCollections.labels.filter((l) => !l.sealed));

	function parentPath(e: CollectionEntry): string | undefined {
		return e.depth > 0 ? e.path.slice(0, e.path.length - e.name.length - 3) : undefined;
	}

	function folderRow(prefix: string, e: CollectionEntry, tree: boolean): PickerRow {
		return {
			key: `${prefix}:${e.id}`,
			title: e.name,
			path: tree ? undefined : parentPath(e),
			depth: tree ? e.depth : 0,
			icon: FolderIcon,
			iconColor: e.color ? collectionColor(e.color) : undefined,
			pick: () => onFolder(e.id)
		};
	}

	function systemRow(prefix: string, t: SystemTarget): PickerRow {
		return { key: `${prefix}:${t.id}`, title: t.label, icon: t.icon, pick: () => onSystem(t.id) };
	}

	function labelRow(e: CollectionEntry, tree: boolean): PickerRow {
		return {
			key: `la:${e.id}`,
			title: e.name,
			path: tree ? undefined : parentPath(e),
			depth: tree ? e.depth : 0,
			dot: collectionColor(e.color),
			pick: () => onLabelArchive?.(e.id)
		};
	}

	const recentRows = $derived.by(() => {
		const out: PickerRow[] = [];
		for (const id of accountSettings.mailRecents.move) {
			const sys = systemTargets.find((t) => t.id === id);
			const folder = sys ? undefined : folders.find((f) => f.id === id);
			if (sys) out.push(systemRow('recent', sys));
			else if (folder) out.push(folderRow('recent', folder, false));
			if (out.length === RECENT_LIMIT) break;
		}
		return out;
	});

	const sections = $derived.by<PickerSection[]>(() => {
		const q = query.trim();
		const canLabel = !!onLabelArchive;
		if (q) {
			const lower = q.toLocaleLowerCase();
			return [
				{
					key: 'matches',
					rows: [
						...systemTargets.filter((t) => t.label.toLocaleLowerCase().includes(lower)).map((t) => systemRow('sys', t)),
						...searchEntries(folders, q).map((f) => folderRow('folder', f, false))
					]
				},
				{
					key: 'label-archive',
					title: m.mail_reader_label_and_archive(),
					rows: canLabel ? searchEntries(labels, q).map((l) => labelRow(l, false)) : []
				}
			];
		}
		return [
			{ key: 'recent', title: m.mail_picker_recent(), rows: recentRows },
			{
				key: 'favorites',
				title: m.mail_sidebar_favorites(),
				rows: folders.filter((f) => f.favorite).map((f) => folderRow('fav', f, false))
			},
			{ key: 'sys', title: m.mail_reader_move_to(), rows: systemTargets.map((t) => systemRow('sys', t)) },
			{
				key: 'folders',
				title: m.mail_collection_folders(),
				rows: folders.map((f) => folderRow('folder', f, true))
			},
			{
				key: 'label-archive',
				title: m.mail_reader_label_and_archive(),
				rows: canLabel ? labels.map((l) => labelRow(l, true)) : []
			}
		];
	});

	const createText = $derived.by(() => {
		const q = query.trim();
		if (!q) return m.mail_collection_new_folder();
		if (hasExactName(mailCollections.folders, q)) return null;
		return m.mail_picker_create_folder({ name: q });
	});
</script>

<CollectionPicker
	{anchor}
	label={m.mail_reader_move_to()}
	placeholder={m.mail_collection_move_find_folder()}
	bind:query
	{sections}
	createKind="folder"
	{createText}
	onCreated={(entry) => onFolder(entry.id)}
	onCancel={onClose}
	onDismiss={onClose}
/>
