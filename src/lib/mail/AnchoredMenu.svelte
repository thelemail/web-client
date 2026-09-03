<script lang="ts">
	import type { Snippet } from 'svelte';
	import { portal } from '$lib/actions/portal';

	interface Props {
		anchor: HTMLElement | undefined;
		children: Snippet;
		panel?: HTMLDivElement;
		extraClass?: string;
		role?: 'menu' | 'dialog';
		label?: string;
	}

	let {
		anchor,
		children,
		panel = $bindable(),
		extraClass = '',
		role = 'menu',
		label
	}: Props = $props();

	const GAP = 10;
	const EDGE = 12;

	let pos = $state({ left: -9999, top: -9999, ready: false });

	function place() {
		if (!anchor || !panel) return;
		const rect = anchor.getBoundingClientRect();
		const w = panel.offsetWidth;
		const h = panel.offsetHeight;
		let left = rect.right - w;
		if (left + w > window.innerWidth - EDGE) left = window.innerWidth - w - EDGE;
		if (left < EDGE) left = EDGE;
		let top = rect.bottom + GAP;
		if (top + h > window.innerHeight - EDGE) top = Math.max(EDGE, rect.top - GAP - h);
		pos = { left, top, ready: true };
	}

	$effect(() => {
		void anchor;
		place();
		document.addEventListener('scroll', place, true);
		return () => document.removeEventListener('scroll', place, true);
	});
</script>

<svelte:window onresize={place} />

<div
	class="menu menu-portal {extraClass}"
	use:portal={'.mail-app'}
	bind:this={panel}
	{role}
	aria-label={label}
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	style:visibility={pos.ready ? 'visible' : 'hidden'}
>
	{@render children()}
</div>
