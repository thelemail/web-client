<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import { SvelteSet } from 'svelte/reactivity';
	import { untrack } from 'svelte';
	import MessagesSquare from '@lucide/svelte/icons/messages-square';
	import ThreadMessage from './ThreadMessage.svelte';
	import { foldRows } from './threadFold';
	import type { ThreadEntry } from './data';

	interface Props {
		entries: ThreadEntry[];
		focusId?: string;
		initialOpen: string[];
		onNeed?: (id: string) => void;
		onConfirmKeyChange?: (address: string) => void | Promise<void>;
		onUnsubscribe?: (e: ThreadEntry) => void;
		baseFolder?: string;
		canMove?: boolean;
		canLabel?: boolean;
		openPicker?: string | null;
		onPicker?: (kind: 'move' | 'labels', entry: ThreadEntry, anchor: HTMLElement) => void;
	}

	let {
		entries,
		focusId,
		initialOpen,
		onNeed,
		onConfirmKeyChange,
		onUnsubscribe,
		baseFolder,
		canMove = false,
		canLabel = false,
		openPicker = null,
		onPicker
	}: Props = $props();

	const FOCUS_GAP = 12;
	const SETTLE_MS = 400;

	const open = new SvelteSet<string>(untrack(() => initialOpen));
	const known = new Set<string>(untrack(() => entries.flatMap((e) => (e.id ? [e.id] : []))));
	let revealed = $state(false);
	let settled = $state(false);
	let wrap: HTMLDivElement | undefined = $state();

	$effect(() => {
		const last = entries.at(-1);
		for (const e of entries) {
			if (!e.id || known.has(e.id)) continue;
			known.add(e.id);
			if (e === last || (e.unread && !e.me)) open.add(e.id);
		}
	});

	const rows = $derived(foldRows(entries, open, revealed));
	const allOpen = $derived(entries.every((e) => !e.id || open.has(e.id)));

	$effect(() => {
		for (const row of rows) {
			if (row.kind !== 'entry') continue;
			const e = entries[row.index];
			if (e?.id && !e.loaded) onNeed?.(e.id);
		}
	});

	$effect(() => {
		const root = wrap;
		const target = untrack(() => focusId);
		if (!root) return;
		const scroller = root.closest<HTMLElement>('.reader-scroll');
		const card = () =>
			target ? root.querySelector<HTMLElement>(`[data-entry="${CSS.escape(target)}"]`) : null;
		if (!scroller || !card()) {
			settled = true;
			return;
		}
		const offsetOf = (el: HTMLElement) =>
			el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		const fitted = () => {
			const frame = card()?.querySelector<HTMLIFrameElement>('iframe');
			return !frame || frame.dataset.fitted === '1';
		};
		let anchor = 0;
		let placed = false;
		let held = true;
		const place = () => {
			if (placed) return;
			placed = true;
			const el = card();
			if (el) {
				const start = offsetOf(el);
				anchor = start > scroller.clientHeight * 0.4 ? FOCUS_GAP : start;
				scroller.scrollTop += start - anchor;
			}
			settled = true;
		};
		const settle = () => {
			if (fitted()) place();
		};
		const release = () => {
			held = false;
		};
		const events = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;
		for (const ev of events) document.addEventListener(ev, release, { capture: true, passive: true });
		const ro = new ResizeObserver(() => {
			if (!placed) return settle();
			if (!held) return;
			const el = card();
			if (!el) return;
			const drift = offsetOf(el) - anchor;
			if (Math.abs(drift) >= 1) scroller.scrollTop += drift;
		});
		ro.observe(root);
		const frame = card()?.querySelector('iframe');
		frame?.addEventListener('load', settle);
		const fallback = setTimeout(place, SETTLE_MS);
		settle();
		return () => {
			clearTimeout(fallback);
			frame?.removeEventListener('load', settle);
			ro.disconnect();
			for (const ev of events) document.removeEventListener(ev, release, { capture: true });
		};
	});

	function toggle(id: string | undefined) {
		if (!id) return;
		if (open.has(id)) open.delete(id);
		else open.add(id);
	}

	function expandAll() {
		revealed = true;
		for (const e of entries) if (e.id) open.add(e.id);
	}

	function collapseAll() {
		open.clear();
		const keep = focusId ?? entries.at(-1)?.id;
		if (keep) open.add(keep);
	}
</script>

<div class="thread-wrap" class:settling={!settled} bind:this={wrap}>
	<div class="thread-top">
		<span class="thr-n">
			<MessagesSquare size={14} />{msg.mail_thread_count({ count: entries.length })}
		</span>
		<button type="button" class="thr-exp" onclick={allOpen ? collapseAll : expandAll}>
			{allOpen ? msg.mail_thread_collapse_all() : msg.mail_thread_expand_all()}
		</button>
	</div>
	<div class="thread">
		{#each rows as row (row.kind === 'entry' ? (entries[row.index].id ?? `i${row.index}`) : `fold${row.start}`)}
			{#if row.kind === 'entry'}
				{@const e = entries[row.index]}
				<ThreadMessage
					{e}
					isOpen={!!e.id && open.has(e.id)}
					onToggle={() => toggle(e.id)}
					{onConfirmKeyChange}
					{onUnsubscribe}
					{baseFolder}
					{canMove}
					{canLabel}
					{openPicker}
					{onPicker}
				/>
			{:else}
				<button type="button" class="thr-fold" onclick={() => (revealed = true)}>
					<span class="thr-fold-n">{msg.mail_thread_older({ count: row.count })}</span>
				</button>
			{/if}
		{/each}
	</div>
</div>
