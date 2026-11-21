export type AccountTransitionKind = 'switch' | 'signout';

const ARRIVED_MS = 4500;

class AccountTransition {
	current = $state<{ kind: AccountTransitionKind; address: string | null } | null>(null);
	arrived = $state<string | null>(null);
	#arrivedTimer: ReturnType<typeof setTimeout> | null = null;

	async run<T>(kind: AccountTransitionKind, address: string | null, work: () => Promise<T>): Promise<T> {
		this.current = { kind, address };
		try {
			return await work();
		} finally {
			this.current = null;
		}
	}

	announceArrival(address: string): void {
		if (this.#arrivedTimer) clearTimeout(this.#arrivedTimer);
		this.arrived = address;
		this.#arrivedTimer = setTimeout(() => {
			this.arrived = null;
			this.#arrivedTimer = null;
		}, ARRIVED_MS);
	}
}

export const accountTransition = new AccountTransition();
