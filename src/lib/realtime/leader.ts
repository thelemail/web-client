export interface LeaderHandle {
	stop(): void;
	readonly isLeader: boolean;
}

export function supportsElection(): boolean {
	return typeof navigator !== 'undefined' && 'locks' in navigator && !!navigator.locks;
}

export function electLeader(name: string, onLead: () => () => void): LeaderHandle {
	if (!supportsElection()) {
		const cleanup = onLead();
		return {
			stop() {
				cleanup();
			},
			isLeader: true
		};
	}

	let leading = false;
	let cleanup: (() => void) | null = null;
	const controller = new AbortController();

	navigator.locks
		.request(name, { mode: 'exclusive', signal: controller.signal }, () => {
			leading = true;
			cleanup = onLead();
			return new Promise<void>(() => {});
		})
		.catch(() => {});

	return {
		stop() {
			controller.abort();
			if (cleanup) {
				cleanup();
				cleanup = null;
			}
			leading = false;
		},
		get isLeader() {
			return leading;
		}
	};
}
