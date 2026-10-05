<script lang="ts" module>
	export type MenuAnchor = HTMLElement | { x: number; y: number };
</script>

<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import { Folder, FolderOpen, Tag } from 'lucide';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import NavMorph from '$core/components/NavMorph.svelte';
	import type { CollectionUnread } from '$core/api/types';
	import { customFolderRoute, customLabelRoute } from '../data';
	import { collectionColor } from '../collections/palette';
	import {
		moveAmongSiblings,
		siblingIds,
		visibleEntries,
		type CollectionEntry
	} from '../collections/tree';

	interface Props {
		label: string;
		entries: CollectionEntry[];
		all: CollectionEntry[];
		expanded: ReadonlySet<string>;
		counts: Record<string, CollectionUnread>;
		activeRoute: string | null;
		slotBase: string;
		flat?: boolean;
		filtering?: boolean;
		menuFor?: string | null;
		onToggle: (id: string, open: boolean) => void;
		onExpandSiblings: (ids: string[]) => void;
		onMenu: (entry: CollectionEntry, anchor: MenuAnchor, returnTo: HTMLElement) => void;
		onMove: (entry: CollectionEntry, delta: number) => void;
		onReorder: (entry: CollectionEntry, order: string[]) => void;
		onNavigate: () => void;
	}

	let {
		label,
		entries,
		all,
		expanded,
		counts,
		activeRoute,
		slotBase,
		flat = false,
		filtering = false,
		menuFor = null,
		onToggle,
		onExpandSiblings,
		onMenu,
		onMove,
		onReorder,
		onNavigate
	}: Props = $props();

	const LONG_PRESS_MS = 500;
	const DRAG_THRESHOLD = 6;
	const TOUCH_SLOP = 10;
	const TYPEAHEAD_MS = 600;

	let list = $state<HTMLUListElement>();
	let focusId = $state<string | null>(null);

	const parents = $derived(new Set(all.map((e) => e.parentId).filter((p): p is string => !!p)));
	const byId = $derived(new Map(all.map((e) => [e.id, e])));
	const rows = $derived(flat || filtering ? entries : visibleEntries(entries, expanded));

	function routeOf(e: CollectionEntry): string {
		return e.kind === 'folder' ? customFolderRoute(e.id) : customLabelRoute(e.id);
	}

	function hrefOf(e: CollectionEntry): string {
		return `${slotBase}/mail/${routeOf(e)}`;
	}

	function isOpen(e: CollectionEntry): boolean {
		return !flat && parents.has(e.id) && (filtering || expanded.has(e.id));
	}

	function badge(e: CollectionEntry): { count: number; text: string } | null {
		const c = counts[e.id];
		if (!c) return null;
		const rolled = parents.has(e.id) && !isOpen(e);
		const count = rolled ? c.subtree : c.direct;
		if (!count) return null;
		const text = !rolled
			? m.mail_sidebar_unread({ count })
			: e.kind === 'folder'
				? m.mail_sidebar_unread_subfolders({ count })
				: m.mail_sidebar_unread_sublabels({ count });
		return { count, text };
	}

	const activeId = $derived(rows.find((e) => routeOf(e) === activeRoute)?.id ?? null);
	const tabId = $derived(
		(focusId && rows.some((e) => e.id === focusId) ? focusId : null) ?? activeId ?? rows[0]?.id ?? null
	);

	function linkFor(id: string): HTMLAnchorElement | null {
		if (!list) return null;
		for (const a of list.querySelectorAll<HTMLAnchorElement>('a[data-id]')) {
			if (a.dataset.id === id) return a;
		}
		return null;
	}

	function focusRow(id: string | undefined) {
		if (!id) return;
		focusId = id;
		linkFor(id)?.focus();
	}

	let typed = '';
	let typedAt = 0;

	function typeahead(from: number, ch: string) {
		const now = Date.now();
		typed = now - typedAt > TYPEAHEAD_MS ? ch : typed + ch;
		typedAt = now;
		const q = typed.toLocaleLowerCase();
		const start = typed.length === 1 ? from + 1 : from;
		for (let k = 0; k < rows.length; k++) {
			const e = rows[(start + k) % rows.length];
			if (e.name.toLocaleLowerCase().startsWith(q)) {
				focusRow(e.id);
				return;
			}
		}
	}

	function onKeydown(ev: KeyboardEvent) {
		const target = ev.target as HTMLElement;
		const id = target.closest<HTMLElement>('a[data-id]')?.dataset.id;
		if (!id) return;
		const i = rows.findIndex((e) => e.id === id);
		const e = rows[i];
		if (!e) return;

		if (ev.altKey && ev.shiftKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
			ev.preventDefault();
			onMove(e, ev.key === 'ArrowUp' ? -1 : 1);
			return;
		}
		if ((ev.shiftKey && ev.key === 'F10') || ev.key === 'ContextMenu') {
			ev.preventDefault();
			onMenu(e, target, target);
			return;
		}
		if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

		switch (ev.key) {
			case 'ArrowDown':
				ev.preventDefault();
				focusRow(rows[i + 1]?.id);
				return;
			case 'ArrowUp':
				ev.preventDefault();
				focusRow(rows[i - 1]?.id);
				return;
			case 'Home':
				ev.preventDefault();
				focusRow(rows[0]?.id);
				return;
			case 'End':
				ev.preventDefault();
				focusRow(rows[rows.length - 1]?.id);
				return;
			case 'ArrowRight':
				if (flat || !parents.has(e.id)) return;
				ev.preventDefault();
				if (!isOpen(e)) onToggle(e.id, true);
				else if (rows[i + 1]?.parentId === e.id) focusRow(rows[i + 1].id);
				return;
			case 'ArrowLeft':
				if (flat) return;
				ev.preventDefault();
				if (isOpen(e) && !filtering) onToggle(e.id, false);
				else if (e.parentId && rows.some((r) => r.id === e.parentId)) focusRow(e.parentId);
				return;
			case '*':
				if (flat || filtering) return;
				ev.preventDefault();
				onExpandSiblings(siblingIds(all, e.id).filter((s) => parents.has(s)));
				return;
		}
		if (ev.key.length === 1 && ev.key !== ' ') {
			ev.preventDefault();
			typeahead(i, ev.key);
		}
	}

	type Press = {
		entry: CollectionEntry;
		pointerId: number;
		touch: boolean;
		x: number;
		y: number;
		el: HTMLElement;
		timer: ReturnType<typeof setTimeout> | null;
	};

	let press: Press | null = null;
	let suppressClick = false;
	let dragId = $state<string | null>(null);
	let drop = $state<{ id: string; after: boolean } | null>(null);

	const canDrag = $derived(!flat && !filtering);

	function endPress() {
		if (press?.timer) clearTimeout(press.timer);
		press = null;
		dragId = null;
		drop = null;
	}

	function onPointerDown(ev: PointerEvent, e: CollectionEntry) {
		if (ev.button !== 0) return;
		endPress();
		const el = ev.currentTarget as HTMLElement;
		const touch = ev.pointerType !== 'mouse';
		press = { entry: e, pointerId: ev.pointerId, touch, x: ev.clientX, y: ev.clientY, el, timer: null };
		if (touch) {
			const p = press;
			p.timer = setTimeout(() => {
				if (press !== p) return;
				p.timer = null;
				suppressClick = true;
				onMenu(e, { x: p.x, y: p.y }, el);
				press = null;
			}, LONG_PRESS_MS);
		}
	}

	function resolveDrop(x: number, y: number): { id: string; after: boolean } | null {
		if (!press || !list) return null;
		const sibs = siblingIds(all, press.entry.id);
		const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row]');
		if (!row || !list.contains(row)) return null;
		let id: string | null = row.dataset.row ?? null;
		let nested = false;
		while (id && !sibs.includes(id)) {
			id = byId.get(id)?.parentId ?? null;
			nested = true;
		}
		if (!id || id === press.entry.id) return null;
		if (nested) return { id, after: true };
		const rect = row.getBoundingClientRect();
		return { id, after: y > rect.top + rect.height / 2 };
	}

	function onPointerMove(ev: PointerEvent) {
		if (!press || ev.pointerId !== press.pointerId) return;
		const dist = Math.hypot(ev.clientX - press.x, ev.clientY - press.y);
		if (press.touch) {
			if (dist > TOUCH_SLOP) endPress();
			return;
		}
		if (!dragId) {
			if (!canDrag || dist < DRAG_THRESHOLD) return;
			dragId = press.entry.id;
			press.el.setPointerCapture(ev.pointerId);
		}
		drop = resolveDrop(ev.clientX, ev.clientY);
	}

	function onPointerUp(ev: PointerEvent) {
		if (!press || ev.pointerId !== press.pointerId) return;
		if (dragId) {
			suppressClick = true;
			const target = drop;
			const entry = press.entry;
			if (target) {
				const sibs = siblingIds(all, entry.id);
				const at = sibs.filter((s) => s !== entry.id).indexOf(target.id) + (target.after ? 1 : 0);
				const order = moveAmongSiblings(sibs, entry.id, at);
				if (order.join() !== sibs.join()) onReorder(entry, order);
			}
		}
		endPress();
	}

	function onClick(ev: MouseEvent) {
		if (suppressClick) {
			suppressClick = false;
			ev.preventDefault();
			return;
		}
		onNavigate();
	}

	function onContextMenu(ev: MouseEvent, e: CollectionEntry) {
		ev.preventDefault();
		if (menuFor === e.id) return;
		endPress();
		onMenu(e, { x: ev.clientX, y: ev.clientY }, ev.currentTarget as HTMLElement);
	}

	function onDragKey(ev: KeyboardEvent) {
		if (ev.key === 'Escape' && dragId) {
			ev.preventDefault();
			endPress();
			suppressClick = true;
		}
	}
</script>

<svelte:window onkeydown={onDragKey} />

<ul class="nav-list ctree" role="tree" aria-label={label} bind:this={list} onkeydown={onKeydown}>
	{#each rows as e, i (e.id)}
		{@const route = routeOf(e)}
		{@const on = route === activeRoute}
		{@const hasKids = !flat && parents.has(e.id)}
		{@const open = isOpen(e)}
		{@const b = badge(e)}
		<li
			role="none"
			class="fld custom ctree-row"
			class:active={on}
			class:unread={!!b}
			class:menu-on={menuFor === e.id}
			class:dragging={dragId === e.id}
			class:drop-before={drop?.id === e.id && !drop.after}
			class:drop-after={drop?.id === e.id && drop.after}
			data-row={e.id}
			style:--depth={flat || filtering ? 0 : e.depth}
			style:--fld-tint={e.color ? collectionColor(e.color) : undefined}
		>
			{#if !flat && !filtering}
				{#if hasKids}
					<button
						type="button"
						class="ctree-chev"
						class:open
						tabindex="-1"
						aria-label={open
							? m.mail_sidebar_collapse_item({ name: e.path })
							: m.mail_sidebar_expand_item({ name: e.path })}
						onclick={() => onToggle(e.id, !open)}
					>
						<ChevronRight />
					</button>
				{:else}
					<span class="ctree-chev" aria-hidden="true"></span>
				{/if}
			{/if}
			<a
				class="ctree-link"
				role="treeitem"
				href={hrefOf(e)}
				data-id={e.id}
				tabindex={tabId === e.id ? 0 : -1}
				aria-level={flat || filtering ? 1 : e.depth + 1}
				aria-setsize={rows.length}
				aria-posinset={i + 1}
				aria-expanded={hasKids && !filtering ? open : undefined}
				aria-selected={on}
				aria-current={on ? 'page' : undefined}
				aria-label={b ? `${e.path}, ${b.text}` : e.path}
				title={e.path}
				draggable="false"
				onfocus={() => (focusId = e.id)}
				onclick={onClick}
				oncontextmenu={(ev) => onContextMenu(ev, e)}
				onpointerdown={(ev) => onPointerDown(ev, e)}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={endPress}
			>
				<NavMorph icon={e.kind === 'label' ? Tag : open || on ? FolderOpen : Folder} />
				<span class="lbl">{e.name}</span>
				{#if b}<span class="ct" aria-hidden="true">{b.count}</span>{/if}
			</a>
			<button
				type="button"
				class="ctree-more"
				tabindex="-1"
				aria-haspopup="menu"
				aria-label={m.mail_sidebar_actions({ name: e.path })}
				onclick={(ev) => {
					const link = linkFor(e.id);
					onMenu(e, ev.currentTarget, link ?? ev.currentTarget);
				}}
			>
				<Ellipsis />
			</button>
		</li>
	{/each}
</ul>
