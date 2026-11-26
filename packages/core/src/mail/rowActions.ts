import { flushSync } from 'svelte';

const SLICE_MS = 8;
const queue = new Set<() => void>();
let scheduled = false;

function drain(): void {
	scheduled = false;
	const until = performance.now() + SLICE_MS;
	for (const run of queue) {
		queue.delete(run);
		flushSync(run);
		if (performance.now() >= until) break;
	}
	if (queue.size) {
		scheduled = true;
		setTimeout(drain, 0);
	}
}

export function afterRowsPaint(run: () => void): () => void {
	queue.add(run);
	if (!scheduled) {
		scheduled = true;
		requestAnimationFrame(() => setTimeout(drain, 0));
	}
	return () => queue.delete(run);
}
