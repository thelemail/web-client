import type { AccentIntensity } from '$lib/settings/data';

class PreferencesStore {
	accent = $state<AccentIntensity>('standard');
	density = $state<'comfortable' | 'compact'>('comfortable');
	highContrast = $state(false);
	reduceMotion = $state(false);
	textScale = $state(100);
	#accountId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.accent = 'standard';
		this.density = 'comfortable';
		this.highContrast = false;
		this.reduceMotion = false;
		this.textScale = 100;
	}
}

export const preferences = new PreferencesStore();
