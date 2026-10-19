import type { AccentIntensity } from '$core/settings/data';

class PreferencesStore {
	accent = $state<AccentIntensity>('standard');
	density = $state<'comfortable' | 'compact'>('comfortable');
	#accountId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.accent = 'standard';
		this.density = 'comfortable';
	}
}

export const preferences = new PreferencesStore();
