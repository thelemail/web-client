class PreferencesStore {
	density = $state<'comfortable' | 'compact'>('comfortable');
	#accountId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.density = 'comfortable';
	}
}

export const preferences = new PreferencesStore();
