<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { DropdownMenu } from 'bits-ui';
	import Pencil from '@lucide/svelte/icons/pencil';
	import FolderInput from '@lucide/svelte/icons/folder-input';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { COLLECTION_COLOR_KEYS, COLLECTION_COLOR_NAMES, COLLECTION_COLORS } from './palette';
	import type { CollectionEntry } from './tree';

	interface Props {
		entry: CollectionEntry;
		index: number;
		siblings: number;
		onEdit: () => void;
		onRecolor: (color: string | null) => void;
		onMove: () => void;
		onShift: (delta: number) => void;
		onDelete: () => void;
	}

	let { entry, index, siblings, onEdit, onRecolor, onMove, onShift, onDelete }: Props = $props();

	const NONE = 'none';
	const folder = $derived(entry.kind === 'folder');
	const swatches = $derived<string[]>(folder ? [NONE, ...COLLECTION_COLOR_KEYS] : [...COLLECTION_COLOR_KEYS]);
	const current = $derived(entry.color ?? NONE);

	function colorName(key: string): string {
		return key === NONE
			? m.mail_collection_no_color()
			: COLLECTION_COLOR_NAMES[key as keyof typeof COLLECTION_COLOR_NAMES]();
	}
</script>

<DropdownMenu.Item class="mitem" onSelect={onEdit}>
	<Pencil />{m.mail_collection_rename()}
</DropdownMenu.Item>
<DropdownMenu.RadioGroup
	class="coll-swatches"
	aria-label={m.mail_collection_color()}
	value={current}
	onValueChange={(v) => {
		if (v && v !== current) onRecolor(v === NONE ? null : v);
	}}
>
	{#each swatches as key (key)}
		<DropdownMenu.RadioItem
			class="coll-swatch"
			value={key}
			aria-label={colorName(key)}
			title={colorName(key)}
			closeOnSelect={false}
		>
			<span
				class="coll-swatch-dot"
				class:none={key === NONE}
				style:background={key === NONE ? undefined : COLLECTION_COLORS[key as keyof typeof COLLECTION_COLORS]}
			></span>
		</DropdownMenu.RadioItem>
	{/each}
</DropdownMenu.RadioGroup>
<DropdownMenu.Item class="mitem" onSelect={onMove}>
	<FolderInput />{m.mail_collection_move_to()}
</DropdownMenu.Item>
{#if siblings > 1}
	<DropdownMenu.Item class="mitem" disabled={index <= 0} onSelect={() => onShift(-1)}>
		<ArrowUp />{m.mail_sidebar_move_up()}
	</DropdownMenu.Item>
	<DropdownMenu.Item
		class="mitem"
		disabled={index < 0 || index >= siblings - 1}
		onSelect={() => onShift(1)}
	>
		<ArrowDown />{m.mail_sidebar_move_down()}
	</DropdownMenu.Item>
{/if}
<DropdownMenu.Separator class="msep" />
<DropdownMenu.Item class="mitem danger" onSelect={onDelete}>
	<Trash2 />{folder ? m.mail_collection_delete_folder_item() : m.mail_collection_delete_label_item()}
</DropdownMenu.Item>
