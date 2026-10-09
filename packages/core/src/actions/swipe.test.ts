import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { swipe, type SwipeOptions } from './swipe';

function pointer(type: string, x: number, y: number, extra: Partial<PointerEvent> = {}) {
	const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
	Object.assign(e, { pointerId: 1, pointerType: 'touch', isPrimary: true, ...extra });
	return e;
}

describe('swipe', () => {
	let node: HTMLDivElement;
	let opts: SwipeOptions;
	let handle: ReturnType<typeof swipe>;

	beforeEach(() => {
		node = document.createElement('div');
		Object.defineProperty(node, 'clientWidth', { value: 375 });
		node.setPointerCapture = vi.fn();
		node.releasePointerCapture = vi.fn();
		node.hasPointerCapture = vi.fn(() => true);
		document.body.appendChild(node);
		opts = { enabled: true, left: true, right: true, onDrag: vi.fn(), onCommit: vi.fn(), onCancel: vi.fn() };
		handle = swipe(node, opts);
	});

	afterEach(() => {
		handle?.destroy?.();
		node.remove();
	});

	function drag(points: [number, number][], end = 'pointerup') {
		node.dispatchEvent(pointer('pointerdown', 200, 100));
		for (const [x, y] of points) node.dispatchEvent(pointer('pointermove', x, y));
		const [lx, ly] = points[points.length - 1];
		node.dispatchEvent(pointer(end, lx, ly));
	}

	it('commits a left swipe that passes the threshold', () => {
		drag([[190, 101], [150, 102], [90, 103]]);
		expect(opts.onDrag).toHaveBeenLastCalledWith(-110);
		expect(opts.onCommit).toHaveBeenCalledWith('left');
		expect(opts.onCancel).not.toHaveBeenCalled();
	});

	it('snaps back when the swipe stops short', () => {
		drag([[190, 100], [160, 100]]);
		expect(opts.onCommit).not.toHaveBeenCalled();
		expect(opts.onCancel).toHaveBeenCalledTimes(1);
	});

	it('leaves vertical scrolling to the page', () => {
		drag([[201, 120], [202, 180]]);
		expect(opts.onDrag).not.toHaveBeenCalled();
		expect(opts.onCommit).not.toHaveBeenCalled();
		expect(node.setPointerCapture).not.toHaveBeenCalled();
	});

	it('resets when the browser cancels the gesture mid-drag', () => {
		drag([[180, 100], [120, 100]], 'pointercancel');
		expect(opts.onCommit).not.toHaveBeenCalled();
		expect(opts.onCancel).toHaveBeenCalledTimes(1);
		drag([[190, 100], [80, 100]]);
		expect(opts.onCommit).toHaveBeenCalledWith('left');
	});

	it('resets when the window loses focus mid-drag', () => {
		node.dispatchEvent(pointer('pointerdown', 200, 100));
		node.dispatchEvent(pointer('pointermove', 150, 100));
		window.dispatchEvent(new Event('blur'));
		expect(opts.onCancel).toHaveBeenCalledTimes(1);
		node.dispatchEvent(pointer('pointerup', 150, 100));
		expect(opts.onCommit).not.toHaveBeenCalled();
	});

	it('ignores mouse pointers', () => {
		node.dispatchEvent(pointer('pointerdown', 200, 100, { pointerType: 'mouse' }));
		node.dispatchEvent(pointer('pointermove', 50, 100, { pointerType: 'mouse' }));
		node.dispatchEvent(pointer('pointerup', 50, 100, { pointerType: 'mouse' }));
		expect(opts.onDrag).not.toHaveBeenCalled();
		expect(opts.onCommit).not.toHaveBeenCalled();
	});

	it('does not move in a direction that has no action', () => {
		handle?.update?.({ ...opts, right: false });
		drag([[220, 100], [330, 100]]);
		expect(opts.onDrag).toHaveBeenLastCalledWith(0);
		expect(opts.onCommit).not.toHaveBeenCalled();
	});

	it('swallows the click that follows a swipe', () => {
		const open = document.createElement('button');
		const clicked = vi.fn();
		open.addEventListener('click', clicked);
		node.appendChild(open);
		drag([[150, 100], [60, 100]]);
		open.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(clicked).not.toHaveBeenCalled();
		open.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(clicked).toHaveBeenCalledTimes(1);
	});

	it('keeps going when a child hands its implicit touch capture to the row', () => {
		const child = document.createElement('button');
		node.appendChild(child);
		child.dispatchEvent(pointer('pointerdown', 60, 100));
		child.dispatchEvent(pointer('pointermove', 80, 100));
		child.dispatchEvent(pointer('lostpointercapture', 80, 100));
		child.dispatchEvent(pointer('pointermove', 200, 100));
		child.dispatchEvent(pointer('pointerup', 200, 100));
		expect(opts.onCancel).not.toHaveBeenCalled();
		expect(opts.onCommit).toHaveBeenCalledWith('right');
	});

	it('resets when the row itself loses capture', () => {
		node.dispatchEvent(pointer('pointerdown', 200, 100));
		node.dispatchEvent(pointer('pointermove', 150, 100));
		node.dispatchEvent(pointer('lostpointercapture', 150, 100));
		expect(opts.onCancel).toHaveBeenCalledTimes(1);
	});
});
