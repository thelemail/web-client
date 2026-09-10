<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Lock from '@lucide/svelte/icons/lock';
	import { lifecycle } from './lifecycle.svelte';
	import { fmt } from './dates';

	const BLOCK_TITLES = new Set(['Archive', 'Delete', 'Permanently delete', 'Move to trash', 'Restore']);

	const slot = $derived(page.params.slot ?? '0');
	const active = $derived(lifecycle.readOnly);
	const removeAt = $derived(lifecycle.context.dates.remove);

	let tip = $state<{ x: number; y: number; below: boolean } | null>(null);
	let toast = $state(false);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	function blockedControl(node: EventTarget | null): HTMLElement | null {
		if (!(node instanceof Element)) return null;
		if (!node.closest('.mail-app')) return null;
		const btn = node.closest<HTMLElement>('button, a');
		if (!btn) return null;
		if (btn.classList.contains('compose') || btn.classList.contains('fab')) return btn;
		if (btn.classList.contains('rb-btn')) return btn;
		const title = btn.getAttribute('title');
		return title && BLOCK_TITLES.has(title) ? btn : null;
	}

	function onCapture(e: MouseEvent) {
		if (!active) return;
		if (!blockedControl(e.target)) return;
		e.preventDefault();
		e.stopPropagation();
		toast = true;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = false), 3400);
	}

	function onOver(e: MouseEvent) {
		if (!active) return;
		const btn = blockedControl(e.target);
		if (!btn) return;
		const r = btn.getBoundingClientRect();
		const below = r.top < 90;
		tip = { x: r.left + r.width / 2, y: below ? r.bottom : r.top, below };
	}

	function onOut(e: MouseEvent) {
		if (!active) return;
		if (!blockedControl(e.relatedTarget)) tip = null;
	}

	$effect(() => {
		if (!active) {
			tip = null;
			toast = false;
			return;
		}
		document.addEventListener('click', onCapture, true);
		document.addEventListener('mouseover', onOver);
		document.addEventListener('mouseout', onOut);
		return () => {
			document.removeEventListener('click', onCapture, true);
			document.removeEventListener('mouseover', onOver);
			document.removeEventListener('mouseout', onOut);
		};
	});
</script>

{#if active && tip}
	<div class="lc-rotip" class:below={tip.below} style="left:{tip.x}px;top:{tip.y}px">
		Sending and editing are paused — restore your plan to continue. Your mail is safe until
		<span class="mono">{fmt.full(removeAt)}</span>.
	</div>
{/if}

{#if active && toast}
	<div class="lc-ro-toast">
		<Lock size={16} />
		<span>Sending and editing are paused while read-only.</span>
		<a
			href={`/u/${slot}/lifecycle/restore`}
			onclick={(e) => {
				e.preventDefault();
				lifecycle.markRestoreOrigin('grace');
				void goto(`/u/${slot}/lifecycle/restore`);
			}}>Restore</a
		>
	</div>
{/if}
