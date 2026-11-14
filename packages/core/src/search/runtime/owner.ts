export interface Tenure {
	readonly lost: Promise<void>;
	release(): void;
}

export interface Contest {
	steal(): void;
	rejoin(): void;
	stop(): void;
}

export function lockName(accountId: string): string {
	return `thelemail-search:${accountId}`;
}

export function contend(locks: LockManager | null, name: string, onLead: (tenure: Tenure) => void): Contest {
	if (!locks) {
		let release = () => {};
		const lost = new Promise<void>((resolve) => {
			release = resolve;
		});
		onLead({ lost, release });
		return { steal() {}, rejoin() {}, stop: release };
	}

	let stopped = false;
	let controller = new AbortController();
	let current: (() => void) | null = null;
	let waiting = 0;

	const request = (steal: boolean) => {
		const lost = Promise.withResolvers<void>();
		const settle = () => {
			waiting--;
			lost.resolve();
		};
		waiting++;
		const hold = () =>
			new Promise<void>((resolve) => {
				if (stopped) {
					resolve();
					return;
				}
				current = resolve;
				onLead({
					lost: lost.promise,
					release: () => {
						if (current === resolve) current = null;
						resolve();
					}
				});
			});
		const options: LockOptions = steal ? { mode: 'exclusive', steal: true } : { mode: 'exclusive', signal: controller.signal };
		locks.request(name, options, hold).then(settle, settle);
	};

	request(false);

	return {
		steal() {
			if (stopped || current) return;
			controller.abort();
			controller = new AbortController();
			request(true);
		},
		rejoin() {
			if (stopped || waiting > 0) return;
			request(false);
		},
		stop() {
			stopped = true;
			controller.abort();
			current?.();
			current = null;
		}
	};
}
