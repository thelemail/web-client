export type AccountTransitionKind = 'switch' | 'signout';

class AccountTransition {
	current = $state<{ kind: AccountTransitionKind; address: string | null } | null>(null);

	async run<T>(kind: AccountTransitionKind, address: string | null, work: () => Promise<T>): Promise<T> {
		this.current = { kind, address };
		try {
			return await work();
		} finally {
			this.current = null;
		}
	}
}

export const accountTransition = new AccountTransition();
