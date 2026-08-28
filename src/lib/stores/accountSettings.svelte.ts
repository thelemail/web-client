import { getAccountSettings, putAccountSettingsSection } from '$lib/api/accountSettings';
import { locale, type LocaleSettings } from '$lib/mail/locale.svelte';
import { theme, type ThemePref } from './theme.svelte';
import { preferences } from './preferences.svelte';
import { auth } from './auth.svelte';

export const MARK_READ_DELAYS: Record<string, number | null> = {
	'Immediately on open': 0,
	'After 2 seconds': 2000,
	'After 5 seconds': 5000,
	'Never automatically': null
};

export interface OpenMessageSettings {
	markRead: string;
	swipe: string;
}

export interface PrivacySettings {
	stripTrackingParams: boolean;
}

export interface AppearanceSettings {
	theme: ThemePref;
	density: 'comfortable' | 'compact';
}

const DEFAULTS: OpenMessageSettings = {
	markRead: 'After 2 seconds',
	swipe: 'Archive'
};

const PRIVACY_DEFAULTS: PrivacySettings = {
	stripTrackingParams: true
};

const APPEARANCE_DEFAULTS: AppearanceSettings = {
	theme: 'light',
	density: 'comfortable'
};

class AccountSettingsStore {
	hydrated = $state(false);
	readingOpenMessage = $state<OpenMessageSettings>({ ...DEFAULTS });
	privacy = $state<PrivacySettings>({ ...PRIVACY_DEFAULTS });
	appearance = $state<AppearanceSettings>({ ...APPEARANCE_DEFAULTS });
	#accountId: string | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.hydrated = false;
		this.readingOpenMessage = { ...DEFAULTS };
		this.privacy = { ...PRIVACY_DEFAULTS };
		this.appearance = { ...APPEARANCE_DEFAULTS };
		locale.reset();
	}

	#applyAppearance(): void {
		theme.set(this.appearance.theme);
		preferences.density = this.appearance.density;
	}

	get localization(): LocaleSettings {
		return locale.value;
	}

	get timeZone(): string {
		return locale.timeZone;
	}

	markReadDelayMs = $derived<number | null>(
		this.readingOpenMessage.markRead in MARK_READ_DELAYS
			? MARK_READ_DELAYS[this.readingOpenMessage.markRead]
			: null
	);

	async hydrate(): Promise<void> {
		if (this.hydrated) return;
		if (!auth.canEnterApp) return;
		const acct = this.#accountId;
		try {
			const data = await getAccountSettings();
			if (this.#accountId !== acct) return;
			const sections = data.sections ?? {};

			const v = sections['reading_open_message'];
			if (v && typeof v === 'object') {
				const next: OpenMessageSettings = { ...DEFAULTS };
				if (typeof v.markRead === 'string') next.markRead = v.markRead;
				if (typeof v.swipe === 'string') next.swipe = v.swipe;
				this.readingOpenMessage = next;
			}

			const p = sections['privacy'];
			if (p && typeof p === 'object') {
				const next: PrivacySettings = { ...PRIVACY_DEFAULTS };
				if (typeof p.stripTrackingParams === 'boolean') {
					next.stripTrackingParams = p.stripTrackingParams;
				}
				this.privacy = next;
			}

			const a = sections['appearance'];
			if (a && typeof a === 'object') {
				const next: AppearanceSettings = { ...APPEARANCE_DEFAULTS };
				if (a.theme === 'light' || a.theme === 'dark' || a.theme === 'auto') {
					next.theme = a.theme;
				}
				if (a.density === 'comfortable' || a.density === 'compact') {
					next.density = a.density;
				}
				this.appearance = next;
				this.#applyAppearance();
			}

			const l = sections['localization'];
			if (l && typeof l === 'object') {
				const next: LocaleSettings = { ...locale.value };
				if (l.dateFormat === 'dmy' || l.dateFormat === 'mdy' || l.dateFormat === 'iso') {
					next.dateFormat = l.dateFormat;
				}
				if (l.timeFormat === '24' || l.timeFormat === '12') {
					next.timeFormat = l.timeFormat;
				}
				locale.set(next);
			}
		} catch {
		}
		if (this.#accountId === acct) this.hydrated = true;
	}

	async refresh(): Promise<void> {
		this.hydrated = false;
		await this.hydrate();
	}

	setReadingOpenMessage(value: OpenMessageSettings): void {
		this.readingOpenMessage = { ...value };
	}

	setPrivacy(value: PrivacySettings): void {
		this.privacy = { ...value };
	}

	setLocalization(value: LocaleSettings): void {
		locale.set(value);
	}

	persistAppearance(next: AppearanceSettings): Promise<unknown> {
		this.appearance = { ...next };
		this.#applyAppearance();
		return putAccountSettingsSection('appearance', {
			theme: next.theme,
			density: next.density
		});
	}

	setTheme(pref: ThemePref): void {
		void this.persistAppearance({ ...this.appearance, theme: pref }).catch(() => {});
	}
}

export const accountSettings = new AccountSettingsStore();
