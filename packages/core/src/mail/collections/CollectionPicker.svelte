<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { onMount, tick, type Snippet } from 'svelte';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import type { MailCollectionKind } from '$core/api/types';
	import AnchoredMenu from '$core/components/AnchoredMenu.svelte';
	import CollectionCreate from './CollectionCreate.svelte';
	import type { PickerRow, PickerSection } from './picker';
	import type { CollectionEntry } from './tree';

	interface Props {
		anchor: HTMLElement | undefined;
		label: string;
		placeholder: string;
		query: string;
		sections: PickerSection[];
		multi?: boolean;
		createKind: MailCollectionKind;
		create: { text: string; name: string; parent: string | null } | null;
		header?: Snippet;
		footer?: Snippet;
		onCreated: (entry: CollectionEntry) => void;
		onCancel: () => void;
		onDismiss: () => void;
		onSubmit?: () => void;
	}

	let {
		anchor,
		label,
		placeholder,
		query = $bindable(),
		sections,
		multi = false,
		createKind,
		create,
		header,
		footer,
		onCreated,
		onCancel,
		onDismiss,
		onSubmit
	}: Props = $props();

	const uid = $props.id();
	let panel: HTMLDivElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let creating = $state<{ name: string; parent: string | null } | null>(null);
	let cursor = $state(0);

	function startCreate() {
		if (create) creating = { name: create.name, parent: create.parent };
	}

	const groups = $derived.by(() => {
		let index = 0;
		const out = sections
			.filter((s) => s.rows.length > 0)
			.map((s) => ({ ...s, rows: s.rows.map((row) => ({ row, index: index++ })) }));
		if (create) {
			const row: PickerRow = { key: 'create', title: create.text, pick: startCreate };
			out.push({ key: 'create', rows: [{ row, index: index++ }] });
		}
		return out;
	});
	const rows = $derived(groups.flatMap((g) => g.rows.map((r) => r.row)));
	const searching = $derived(query.trim().length > 0);
	const matched = $derived(groups.some((g) => g.key !== 'create'));

	const optionId = (i: number) => `${uid}-opt-${i}`;

	const active = $derived(Math.max(0, Math.min(cursor, rows.length - 1)));

	function setActive(i: number) {
		cursor = i;
		const el = panel?.querySelector(`#${CSS.escape(optionId(i))}`);
		el?.scrollIntoView({ block: 'nearest' });
	}

	function resetQuery() {
		query = '';
		cursor = 0;
	}

	let returnTo: HTMLElement | null = null;

	onMount(() => {
		returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const opener = anchor;
		void tick().then(() => input?.focus());
		return () => {
			const focus = document.activeElement;
			if (focus && focus !== document.body && !panel?.contains(focus)) return;
			const target =
				returnTo && returnTo.isConnected && returnTo !== document.body
					? returnTo
					: opener;
			target?.focus();
		};
	});

	function backToList() {
		creating = null;
		void tick().then(() => input?.focus());
	}

	function created(entry: CollectionEntry) {
		onCreated(entry);
		if (!multi) return;
		creating = null;
		resetQuery();
		void tick().then(() => input?.focus());
	}

	function onInputKey(e: KeyboardEvent) {
		if (rows.length === 0 && e.key !== 'Enter') return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setActive((active + 1) % rows.length);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setActive((active - 1 + rows.length) % rows.length);
		} else if (e.key === 'PageDown') {
			e.preventDefault();
			setActive(Math.min(rows.length - 1, active + 8));
		} else if (e.key === 'PageUp') {
			e.preventDefault();
			setActive(Math.max(0, active - 8));
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (multi && (e.metaKey || e.ctrlKey)) {
				onSubmit?.();
				return;
			}
			rows[active]?.pick();
		}
	}

	function onPanelKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		if (creating) {
			backToList();
		} else if (query) {
			resetQuery();
		} else {
			onCancel();
		}
	}

	function onDocMouseDown(e: MouseEvent) {
		const target = e.target as Node;
		if (panel?.contains(target) || anchor?.contains(target)) return;
		onDismiss();
	}
</script>

<svelte:document onmousedown={onDocMouseDown} />

<AnchoredMenu {anchor} bind:panel extraClass="label-picker coll-picker" role="dialog" {label}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="pk" onkeydown={onPanelKey}>
		{#if creating}
			<div class="pk-create-head">
				<button type="button" class="pk-back" aria-label={m.mail_picker_back()} onclick={backToList}>
					<ArrowLeft size={15} />
				</button>
				<span>{createKind === 'folder' ? m.mail_collection_new_folder() : m.mail_collection_new_label()}</span>
			</div>
			<CollectionCreate kind={createKind} name={creating.name} parent={creating.parent} onCreated={created} />
		{:else}
			{@render header?.()}
			<label class="pk-find">
				<Search size={14} />
				<input
					bind:this={input}
					bind:value={query}
					type="text"
					role="combobox"
					autocomplete="off"
					spellcheck="false"
					aria-expanded="true"
					aria-controls="{uid}-list"
					aria-activedescendant={rows.length > 0 ? optionId(active) : undefined}
					aria-label={placeholder}
					{placeholder}
					oninput={() => (cursor = 0)}
					onkeydown={onInputKey}
				/>
			</label>
			<div
				class="pk-list"
				id="{uid}-list"
				role="listbox"
				aria-label={label}
				aria-multiselectable={multi || undefined}
			>
				{#if searching && !matched}
					<div class="pk-empty">{m.mail_sidebar_find_empty()}</div>
				{/if}
				{#each groups as g (g.key)}
					<div role="group" aria-labelledby={g.title ? `${uid}-${g.key}` : undefined}>
						{#if g.key === 'create'}
							<div class="msep"></div>
						{:else if g.title}
							<div class="menu-lbl" id="{uid}-{g.key}">{g.title}</div>
						{/if}
						{#each g.rows as { row, index } (row.key)}
							{@const Icon = row.key === 'create' ? Plus : row.icon}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								id={optionId(index)}
								class="mitem lp-row pk-row"
								class:active={index === active}
								class:on={row.check === 'on'}
								role="option"
								aria-selected={multi ? row.check === 'on' : index === active}
								aria-checked={multi && row.check ? (row.check === 'mixed' ? 'mixed' : row.check === 'on') : undefined}
								tabindex="-1"
								onmousedown={(e) => e.preventDefault()}
								onmousemove={() => (cursor = index)}
								onclick={() => row.pick()}
							>
								{#if multi && row.check}
									<span class="pk-box" class:checked={row.check !== 'off'} aria-hidden="true">
										{#if row.check === 'on'}<Check size={12} />{:else if row.check === 'mixed'}<Minus size={12} />{/if}
									</span>
								{/if}
								{#if row.depth}
									<span class="lp-indent" style:width="{row.depth * 14}px"></span>
								{/if}
								{#if row.dot}
									<span class="lp-dot" style:background={row.dot}></span>
								{:else if Icon}
									<Icon size={17} color={row.iconColor ?? 'currentColor'} />
								{/if}
								<span class="lp-name" title={row.path ? `${row.path} / ${row.title}` : undefined}>
									{#if row.path}<span class="pk-parent">{`${row.path} / `}</span>{/if}{row.title}
								</span>
							</div>
						{/each}
					</div>
				{/each}
			</div>
			{@render footer?.()}
		{/if}
	</div>
</AnchoredMenu>
