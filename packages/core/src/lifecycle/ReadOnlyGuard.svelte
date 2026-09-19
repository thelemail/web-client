<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Lock from '@lucide/svelte/icons/lock';
	import { lifecycle } from './lifecycle.svelte';
	import { m } from '$paraglide/messages.js';
	import Rich from '$core/i18n/Rich.svelte';
	import { fmt } from './dates';

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
		return btn.hasAttribute('data-mutates') ? btn : null;
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

{#snippet mono(text: string)}<span class="mono">{text}</span>{/snippet}

{#if active && tip}
	<div class="lc-rotip" class:below={tip.below} style="left:{tip.x}px;top:{tip.y}px">
		<Rich text={m.lc_readonly_tip({ date: fmt.full(removeAt) })} tags={{ date: mono }} />
	</div>
{/if}

{#if active && toast}
	<div class="lc-ro-toast">
		<Lock size={16} />
		<span>{m.lc_readonly_toast()}</span>
		<a
			href={`/u/${slot}/lifecycle/restore`}
			onclick={(e) => {
				e.preventDefault();
				lifecycle.markRestoreOrigin('grace');
				void goto(`/u/${slot}/lifecycle/restore`);
			}}>{m.lc_readonly_restore()}</a
		>
	</div>
{/if}
