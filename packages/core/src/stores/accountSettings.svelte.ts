import { getAccountSettings, putAccountSettingsSection } from '$core/api/accountSettings';
import { locale, type LocaleSettings } from '$core/mail/locale.svelte';
import { theme, type ThemePref } from './theme.svelte';
import { preferences } from './preferences.svelte';
import { auth } from './auth.svelte';
import { m } from '$paraglide/messages.js';

export const MARK_READ_DELAYS: Record<string, number | null> = {
	'Immediately on open': 0,
	'After 2 seconds': 2000,
	'After 5 seconds': 5000,
	'Never automatically': null
};

export const MARK_READ_LABELS: Record<string, () => string> = {
	'Immediately on open': () => m.settings_reading_mark_read_immediately(),
	'After 2 seconds': () => m.settings_reading_mark_read_2s(),
	'After 5 seconds': () => m.settings_reading_mark_read_5s(),
	'Never automatically': () => m.settings_reading_mark_read_never()
};

export const SWIPE_LABELS: Record<string, () => string> = {
	Archive: () => m.settings_reading_swipe_archive(),
	Delete: () => m.settings_reading_swipe_delete(),
	'Mark read': () => m.settings_reading_swipe_mark_read(),
	Snooze: () => m.settings_reading_swipe_snooze()
};

export interface OpenMessageSettings {
	markRead: string;
	swipe: string;
}

export interface PrivacySettings {
	stripTrackingParams: boolean;
	shareSpamHeaders: boolean | null;
}

export interface ComposingSettings {
	confirmExternal: boolean;
	confirmSubject: boolean;
	confirmUnencrypted: boolean;
	replyDefault: 'reply' | 'all';
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
	stripTrackingParams: true,
	shareSpamHeaders: null
};

const COMPOSING_DEFAULTS: ComposingSettings = {
	confirmExternal: true,
	confirmSubject: true,
	confirmUnencrypted: true,
	replyDefault: 'reply'
};

const APPEARANCE_DEFAULTS: AppearanceSettings = {
	theme: 'light',
	density: 'comfortable'
};

export type CalendarPrivacyDefault = 'private' | 'busy' | 'shared';

export interface CalendarSettings {
	hidden: string[];
	defaultCalendarId: string | null;
	defaultPrivacy: CalendarPrivacyDefault;
	defaultReminderMinutes: number | null;
	weekStartsOn: 0 | 1;
	startHour: number;
}

const MAX_REMINDER_MINUTES = 10080;

const CALENDAR_DEFAULTS: CalendarSettings = {
	hidden: [],
	defaultCalendarId: null,
	defaultPrivacy: 'busy',
	defaultReminderMinutes: 10,
	weekStartsOn: 1,
	startHour: 6
};

export type MailSidebarSection = 'favorites' | 'folders' | 'labels';

export interface MailSidebarSettings {
	expanded: string[];
	collapsed: MailSidebarSection[];
	showMore: boolean;
}

const MAIL_SIDEBAR_SECTIONS: readonly MailSidebarSection[] = ['favorites', 'folders', 'labels'];
const MAX_SIDEBAR_EXPANDED = 1500;
const SIDEBAR_PERSIST_DELAY_MS = 400;

const MAIL_SIDEBAR_DEFAULTS: MailSidebarSettings = {
	expanded: [],
	collapsed: [],
	showMore: false
};

export function parseMailSidebar(raw: unknown): MailSidebarSettings {
	const next: MailSidebarSettings = { ...MAIL_SIDEBAR_DEFAULTS, expanded: [], collapsed: [] };
	if (!raw || typeof raw !== 'object') return next;
	const v = raw as Record<string, unknown>;
	if (Array.isArray(v.expanded)) {
		next.expanded = [
			...new Set(v.expanded.filter((x): x is string => typeof x === 'string' && x.length <= 64))
		].slice(0, MAX_SIDEBAR_EXPANDED);
	}
	if (Array.isArray(v.collapsed)) {
		next.collapsed = MAIL_SIDEBAR_SECTIONS.filter((s) => (v.collapsed as unknown[]).includes(s));
	}
	if (typeof v.showMore === 'boolean') next.showMore = v.showMore;
	return next;
}

class AccountSettingsStore {
	hydrated = $state(false);
	readingOpenMessage = $state<OpenMessageSettings>({ ...DEFAULTS });
	privacy = $state<PrivacySettings>({ ...PRIVACY_DEFAULTS });
	composing = $state<ComposingSettings>({ ...COMPOSING_DEFAULTS });
	appearance = $state<AppearanceSettings>({ ...APPEARANCE_DEFAULTS });
	calendar = $state<CalendarSettings>({ ...CALENDAR_DEFAULTS });
	mailSidebar = $state<MailSidebarSettings>(parseMailSidebar(null));
	#accountId: string | null = null;
	#sidebarTimer: ReturnType<typeof setTimeout> | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.hydrated = false;
		this.readingOpenMessage = { ...DEFAULTS };
		this.privacy = { ...PRIVACY_DEFAULTS };
		this.composing = { ...COMPOSING_DEFAULTS };
		this.appearance = { ...APPEARANCE_DEFAULTS };
		this.calendar = { ...CALENDAR_DEFAULTS };
		this.mailSidebar = parseMailSidebar(null);
		if (this.#sidebarTimer) clearTimeout(this.#sidebarTimer);
		this.#sidebarTimer = null;
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
				if (typeof p.shareSpamHeaders === 'boolean') {
					next.shareSpamHeaders = p.shareSpamHeaders;
				}
				this.privacy = next;
			}

			const cmp = sections['composing'];
			if (cmp && typeof cmp === 'object') {
				const next: ComposingSettings = { ...COMPOSING_DEFAULTS };
				if (typeof cmp.confirmExternal === 'boolean') next.confirmExternal = cmp.confirmExternal;
				if (typeof cmp.confirmSubject === 'boolean') next.confirmSubject = cmp.confirmSubject;
				if (typeof cmp.confirmUnencrypted === 'boolean') {
					next.confirmUnencrypted = cmp.confirmUnencrypted;
				}
				if (cmp.replyDefault === 'reply' || cmp.replyDefault === 'all') {
					next.replyDefault = cmp.replyDefault;
				}
				this.composing = next;
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

			const c = sections['calendar'];
			if (c && typeof c === 'object') {
				const next: CalendarSettings = { ...CALENDAR_DEFAULTS };
				if (Array.isArray(c.hidden)) {
					next.hidden = c.hidden.filter((x): x is string => typeof x === 'string');
				}
				if (typeof c.defaultCalendarId === 'string') next.defaultCalendarId = c.defaultCalendarId;
				if (
					c.defaultPrivacy === 'private' ||
					c.defaultPrivacy === 'busy' ||
					c.defaultPrivacy === 'shared'
				) {
					next.defaultPrivacy = c.defaultPrivacy;
				}
				if (c.defaultReminderMinutes === null) {
					next.defaultReminderMinutes = null;
				} else if (
					typeof c.defaultReminderMinutes === 'number' &&
					c.defaultReminderMinutes >= 0 &&
					c.defaultReminderMinutes <= MAX_REMINDER_MINUTES
				) {
					next.defaultReminderMinutes = Math.round(c.defaultReminderMinutes);
				}
				if (c.weekStartsOn === 0 || c.weekStartsOn === 1) next.weekStartsOn = c.weekStartsOn;
				if (typeof c.startHour === 'number' && c.startHour >= 0 && c.startHour <= 12) {
					next.startHour = Math.round(c.startHour);
				}
				this.calendar = next;
			}

			if (sections['mail_sidebar'] !== undefined && !this.#sidebarTimer) {
				this.mailSidebar = parseMailSidebar(sections['mail_sidebar']);
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
		} catch {}
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

	async persistShareSpamHeaders(share: boolean): Promise<void> {
		const next: PrivacySettings = { ...this.privacy, shareSpamHeaders: share };
		await putAccountSettingsSection('privacy', { ...next });
		this.privacy = next;
	}

	setComposing(value: ComposingSettings): void {
		this.composing = { ...value };
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

	persistCalendar(next: CalendarSettings): Promise<unknown> {
		this.calendar = { ...next, hidden: [...next.hidden] };
		return putAccountSettingsSection('calendar', {
			hidden: next.hidden,
			defaultCalendarId: next.defaultCalendarId,
			defaultPrivacy: next.defaultPrivacy,
			defaultReminderMinutes: next.defaultReminderMinutes,
			weekStartsOn: next.weekStartsOn,
			startHour: next.startHour
		});
	}

	persistMailSidebar(next: MailSidebarSettings): void {
		const value = parseMailSidebar(next);
		this.mailSidebar = value;
		const acct = this.#accountId;
		if (this.#sidebarTimer) clearTimeout(this.#sidebarTimer);
		this.#sidebarTimer = setTimeout(() => {
			this.#sidebarTimer = null;
			if (this.#accountId !== acct) return;
			void putAccountSettingsSection('mail_sidebar', {
				expanded: this.mailSidebar.expanded,
				collapsed: this.mailSidebar.collapsed,
				showMore: this.mailSidebar.showMore
			}).catch(() => {});
		}, SIDEBAR_PERSIST_DELAY_MS);
	}

	setTheme(pref: ThemePref): void {
		void this.persistAppearance({ ...this.appearance, theme: pref }).catch(() => {});
	}
}

export const accountSettings = new AccountSettingsStore();
