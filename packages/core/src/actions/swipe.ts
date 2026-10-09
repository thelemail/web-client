import type { Action } from 'svelte/action';

export type SwipeDirection = 'left' | 'right';

export interface SwipeOptions {
	enabled: boolean;
	left: boolean;
	right: boolean;
	onDrag: (dx: number) => void;
	onCommit: (dir: SwipeDirection) => void;
	onCancel: () => void;
}

const LOCK = 8;

export function swipeThreshold(width: number): number {
	return Math.min(96, width * 0.3);
}

export const swipe: Action<HTMLElement, SwipeOptions> = (node, initial) => {
	let opts = initial;
	let pointer: number | null = null;
	let startX = 0;
	let startY = 0;
	let dx = 0;
	let locked: 'x' | 'y' | null = null;

	function clamp(raw: number): number {
		if (raw < 0 && !opts.left) return 0;
		if (raw > 0 && !opts.right) return 0;
		return raw;
	}

	function reset(notify: boolean) {
		const wasDragging = locked === 'x' && dx !== 0;
		if (pointer !== null && node.hasPointerCapture?.(pointer)) node.releasePointerCapture(pointer);
		pointer = null;
		locked = null;
		dx = 0;
		if (notify && wasDragging) opts.onCancel();
	}

	function swallowClick(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
	}

	function onDown(e: PointerEvent) {
		if (!opts.enabled || e.pointerType !== 'touch' || !e.isPrimary || pointer !== null) return;
		pointer = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		dx = 0;
		locked = null;
	}

	function onMove(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		const mx = e.clientX - startX;
		const my = e.clientY - startY;
		if (locked === null) {
			if (Math.abs(mx) < LOCK && Math.abs(my) < LOCK) return;
			locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
			if (locked === 'y') return;
			node.setPointerCapture?.(e.pointerId);
		}
		if (locked !== 'x') return;
		dx = clamp(mx);
		opts.onDrag(dx);
	}

	function onUp(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		if (locked === 'x') {
			node.addEventListener('click', swallowClick, { capture: true, once: true });
			setTimeout(() => node.removeEventListener('click', swallowClick, { capture: true }), 400);
			const committed = Math.abs(dx) >= swipeThreshold(node.clientWidth);
			const dir: SwipeDirection = dx < 0 ? 'left' : 'right';
			const moved = dx !== 0;
			pointer = null;
			locked = null;
			dx = 0;
			if (committed) opts.onCommit(dir);
			else if (moved) opts.onCancel();
			return;
		}
		reset(false);
	}

	function onAbort(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		reset(true);
	}

	function onLostCapture(e: PointerEvent) {
		if (e.target === node) onAbort(e);
	}

	function onBlur() {
		if (pointer !== null) reset(true);
	}

	node.addEventListener('pointerdown', onDown);
	node.addEventListener('pointermove', onMove);
	node.addEventListener('pointerup', onUp);
	node.addEventListener('pointercancel', onAbort);
	node.addEventListener('lostpointercapture', onLostCapture);
	window.addEventListener('blur', onBlur);

	return {
		update(next) {
			opts = next;
			if (!opts.enabled && pointer !== null) reset(true);
		},
		destroy() {
			node.removeEventListener('pointerdown', onDown);
			node.removeEventListener('pointermove', onMove);
			node.removeEventListener('pointerup', onUp);
			node.removeEventListener('pointercancel', onAbort);
			node.removeEventListener('lostpointercapture', onLostCapture);
			node.removeEventListener('click', swallowClick, { capture: true });
			window.removeEventListener('blur', onBlur);
		}
	};
};
