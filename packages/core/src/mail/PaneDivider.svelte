<script lang="ts">
	import { m as msg } from '$paraglide/messages.js';
	import { mailPane, LIST_MIN, READER_MIN } from '$core/stores/mailPane.svelte';

	let el: HTMLDivElement | undefined = $state();
	let now = $state(0);
	let max = $state(LIST_MIN);
	let dragging = $state(false);
	let startX = 0;
	let startW = 0;

	function list(): HTMLElement | null {
		const prev = el?.previousElementSibling;
		return prev instanceof HTMLElement ? prev : null;
	}

	function measure() {
		const host = el?.parentElement;
		max = Math.max(LIST_MIN, (host?.clientWidth ?? 0) - READER_MIN);
		now = list()?.offsetWidth ?? LIST_MIN;
	}

	function clamp(px: number): number {
		return Math.min(max, Math.max(LIST_MIN, Math.round(px)));
	}

	$effect(() => {
		const host = el?.parentElement;
		if (!host) return;
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(host);
		return () => ro.disconnect();
	});

	function commit(px: number) {
		mailPane.set(clamp(px));
		measure();
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0 || !el) return;
		e.preventDefault();
		measure();
		dragging = true;
		startX = e.clientX;
		startW = now;
		el.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		now = clamp(startW + e.clientX - startX);
		mailPane.preview(now);
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		el?.releasePointerCapture(e.pointerId);
		commit(now);
	}

	function onKeyDown(e: KeyboardEvent) {
		measure();
		const step = e.shiftKey ? 64 : 16;
		if (e.key === 'ArrowLeft') commit(now - step);
		else if (e.key === 'ArrowRight') commit(now + step);
		else if (e.key === 'Home') commit(LIST_MIN);
		else if (e.key === 'End') commit(max);
		else if (e.key === 'Enter') reset();
		else return;
		e.preventDefault();
		e.stopPropagation();
	}

	function reset() {
		mailPane.reset();
		measure();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={el}
	class="pane-divider"
	class:dragging
	role="separator"
	aria-orientation="vertical"
	aria-label={msg.mail_pane_resize()}
	aria-valuemin={LIST_MIN}
	aria-valuemax={max}
	aria-valuenow={now}
	tabindex="0"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	ondblclick={reset}
	onkeydown={onKeyDown}
></div>
