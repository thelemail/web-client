import { flushSync } from 'svelte';

const SLICE_MS = 8;
const IDLE_RESERVE_MS = 3;
const NEAR_MARGIN = '200px 0px';
const SCROLL_QUIET_MS = 200;
const near = new Set<() => void>();
const idle = new Set<() => void>();
const waiting = new Map<Element, () => void>();
let nearScheduled = false;
let idleScheduled = false;
let observer: IntersectionObserver | null = null;
let lastScroll = -Infinity;
let watchingScroll = false;

function watchScroll(): void {
	if (watchingScroll || typeof document === 'undefined') return;
	watchingScroll = true;
	document.addEventListener('scroll', () => (lastScroll = performance.now()), { capture: true, passive: true });
}

function scrolling(): boolean {
	return performance.now() - lastScroll < SCROLL_QUIET_MS;
}

function drainNear(): void {
	if (scrolling()) {
		setTimeout(drainNear, SCROLL_QUIET_MS);
		return;
	}
	nearScheduled = false;
	const until = performance.now() + SLICE_MS;
	for (const run of near) {
		near.delete(run);
		idle.delete(run);
		flushSync(run);
		if (performance.now() >= until) break;
	}
	if (near.size) {
		nearScheduled = true;
		setTimeout(drainNear, 0);
	}
}

function drainIdle(deadline: IdleDeadline): void {
	idleScheduled = false;
	if (scrolling()) {
		setTimeout(scheduleIdle, SCROLL_QUIET_MS);
		return;
	}
	for (const run of idle) {
		if (deadline.timeRemaining() < IDLE_RESERVE_MS) break;
		idle.delete(run);
		near.delete(run);
		flushSync(run);
	}
	if (idle.size) scheduleIdle();
}

function scheduleIdle(): void {
	if (idleScheduled) return;
	idleScheduled = true;
	if (typeof requestIdleCallback === 'function') {
		requestIdleCallback(drainIdle);
		return;
	}
	setTimeout(() => {
		const until = performance.now() + SLICE_MS;
		drainIdle({ didTimeout: false, timeRemaining: () => until - performance.now() });
	}, 50);
}

function promote(run: () => void): void {
	near.add(run);
	if (!nearScheduled) {
		nearScheduled = true;
		requestAnimationFrame(() => setTimeout(drainNear, 0));
	}
}

function nearViewport(): IntersectionObserver {
	observer ??= new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const run = waiting.get(entry.target);
				waiting.delete(entry.target);
				observer?.unobserve(entry.target);
				if (run && idle.has(run)) promote(run);
			}
		},
		{ rootMargin: NEAR_MARGIN }
	);
	return observer;
}

export function whenRowNear(row: Element, run: () => void): () => void {
	watchScroll();
	waiting.set(row, run);
	idle.add(run);
	nearViewport().observe(row);
	scheduleIdle();
	return () => {
		waiting.delete(row);
		observer?.unobserve(row);
		near.delete(run);
		idle.delete(run);
	};
}
