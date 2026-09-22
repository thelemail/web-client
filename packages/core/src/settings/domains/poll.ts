export function pollWhileVisible(run: () => Promise<unknown>, everyMs: number): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let busy = false;
	const visible = () => document.visibilityState === 'visible';
	const schedule = () => {
		clearTimeout(timer);
		timer = undefined;
		if (!stopped && visible()) timer = setTimeout(() => void tick(), everyMs);
	};
	const tick = async () => {
		if (busy || stopped) return;
		busy = true;
		await run().catch(() => undefined);
		busy = false;
		schedule();
	};
	const onVisibility = () => (visible() ? void tick() : schedule());
	document.addEventListener('visibilitychange', onVisibility);
	schedule();
	return () => {
		stopped = true;
		clearTimeout(timer);
		document.removeEventListener('visibilitychange', onVisibility);
	};
}
