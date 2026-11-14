const BOOT_QUIET_MS = 2000;
const IDLE_TIMEOUT_MS = 5000;

export function afterBoot(work: () => void): () => void {
	let idle: number | undefined;
	const timer = setTimeout(() => {
		if (typeof requestIdleCallback !== 'function') {
			work();
			return;
		}
		idle = requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
	}, BOOT_QUIET_MS);
	return () => {
		clearTimeout(timer);
		if (idle !== undefined) cancelIdleCallback(idle);
	};
}
