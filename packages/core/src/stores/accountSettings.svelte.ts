import { getAccountSettings, putAccountSettingsSection } from '$core/api/accountSettings';
import { locale, type LocaleSettings } from '$core/mail/locale.svelte';
import { theme, type ThemePref } from './theme.svelte';
import { auth } from './auth.svelte';
import { m } from '$paraglide/messages.js';

export type MarkReadOption = 'immediately' | 'after_2s' | 'never';

export const MARK_READ_DELAYS: Record<MarkReadOption, number | null> = {
	immediately: 0,
	after_2s: 2000,
	never: null
};

export const MARK_READ_LABELS: Record<MarkReadOption, () => string> = {
	immediately: () => m.settings_reading_mark_read_immediately(),
	after_2s: () => m.settings_reading_mark_read_2s(),
	never: () => m.settings_reading_mark_read_never()
};

const LEGACY_MARK_READ: Record<string, MarkReadOption> = {
	'Immediately on open': 'immediately',
	'After 2 seconds': 'after_2s',
	'Never automatically': 'never'
};

export function isMarkReadOption(v: string): v is MarkReadOption {
	return Object.hasOwn(MARK_READ_DELAYS, v);
}

export interface OpenMessageSettings {
	markRead: MarkReadOption;
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
}

const DEFAULTS: OpenMessageSettings = {
	markRead: 'after_2s'
};

function parseReadingOpenMessage(raw: Record<string, unknown>): OpenMessageSettings {
	const markRead = raw.markRead;
	if (typeof markRead === 'number' || markRead === null) {
		const id = (Object.keys(MARK_READ_DELAYS) as MarkReadOption[]).find(
			(k) => MARK_READ_DELAYS[k] === markRead
		);
		if (id) return { markRead: id };
	}
	if (typeof markRead === 'string' && Object.hasOwn(LEGACY_MARK_READ, markRead)) {
		return { markRead: LEGACY_MARK_READ[markRead] };
	}
	return { ...DEFAULTS };
}

function sectionRecord(raw: unknown): Record<string, unknown> {
	return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
}

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
	theme: 'light'
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

export type MailRecentKind = 'move' | 'labels';

export interface MailRecents {
	move: string[];
	labels: string[];
}

const MAX_RECENTS = 6;

function recentIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const ids = raw.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64);
	return [...new Set(ids)].slice(0, MAX_RECENTS);
}

export function parseMailRecents(raw: unknown): MailRecents {
	if (!raw || typeof raw !== 'object') return { move: [], labels: [] };
	const v = raw as Record<string, unknown>;
	return { move: recentIds(v.move), labels: recentIds(v.labels) };
}

export function pushRecents(list: readonly string[], used: readonly string[]): string[] {
	return recentIds([...[...used].reverse(), ...list]);
}

export type AccountSettingsStatus = 'idle' | 'loading' | 'ready' | 'error';

class AccountSettingsStore {
	status = $state<AccountSettingsStatus>('idle');
	error = $state<unknown>(null);
	readingOpenMessage = $state<OpenMessageSettings>({ ...DEFAULTS });
	privacy = $state<PrivacySettings>({ ...PRIVACY_DEFAULTS });
	composing = $state<ComposingSettings>({ ...COMPOSING_DEFAULTS });
	appearance = $state<AppearanceSettings>({ ...APPEARANCE_DEFAULTS });
	calendar = $state<CalendarSettings>({ ...CALENDAR_DEFAULTS });
	mailSidebar = $state<MailSidebarSettings>(parseMailSidebar(null));
	mailRecents = $state<MailRecents>(parseMailRecents(null));
	#accountId: string | null = null;
	#raw = new Map<string, Record<string, unknown>>();
	#loading: Promise<void> | null = null;
	#loadedListeners = new Set<() => void>();
	#sidebarTimer: ReturnType<typeof setTimeout> | null = null;
	#recentsTimer: ReturnType<typeof setTimeout> | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.status = 'idle';
		this.error = null;
		this.#loading = null;
		this.readingOpenMessage = { ...DEFAULTS };
		this.#raw = new Map();
		this.privacy = { ...PRIVACY_DEFAULTS };
		this.composing = { ...COMPOSING_DEFAULTS };
		this.appearance = { ...APPEARANCE_DEFAULTS };
		this.calendar = { ...CALENDAR_DEFAULTS };
		this.mailSidebar = parseMailSidebar(null);
		if (this.#sidebarTimer) clearTimeout(this.#sidebarTimer);
		this.#sidebarTimer = null;
		this.mailRecents = parseMailRecents(null);
		if (this.#recentsTimer) clearTimeout(this.#recentsTimer);
		this.#recentsTimer = null;
		locale.reset();
	}

	get accountId(): string | null {
		return this.#accountId;
	}

	get hydrated(): boolean {
		return this.status === 'ready';
	}

	#applyAppearance(): void {
		theme.set(this.appearance.theme);
	}

	get localization(): LocaleSettings {
		return locale.value;
	}

	get timeZone(): string {
		return locale.timeZone;
	}

	markReadDelayMs = $derived<number | null>(MARK_READ_DELAYS[this.readingOpenMessage.markRead]);

	async hydrate(): Promise<void> {
		if (this.status === 'ready') return;
		if (!auth.canEnterApp) return;
		if (this.#loading) return this.#loading;
		this.status = 'loading';
		this.error = null;
		const load = this.#load(false);
		this.#loading = load;
		try {
			await load;
		} finally {
			if (this.#loading === load) this.#loading = null;
		}
	}

	async refresh(): Promise<void> {
		if (this.status !== 'ready') return this.hydrate();
		if (!auth.canEnterApp) return;
		await this.#load(true);
	}

	async #load(silent: boolean): Promise<void> {
		const acct = this.#accountId;
		let data: Awaited<ReturnType<typeof getAccountSettings>>;
		try {
			data = await getAccountSettings();
		} catch (err) {
			if (this.#accountId !== acct || silent) return;
			this.error = err;
			this.status = 'error';
			return;
		}
		if (this.#accountId !== acct) return;
		this.#apply(data);
		this.status = 'ready';
		for (const listener of this.#loadedListeners) listener();
	}

	onLoaded(listener: () => void): () => void {
		this.#loadedListeners.add(listener);
		return () => this.#loadedListeners.delete(listener);
	}

	#apply(data: Awaited<ReturnType<typeof getAccountSettings>>): void {
		const sections = data.sections ?? {};
		this.#raw = new Map(Object.entries(sections).map(([k, v]) => [k, sectionRecord(v)]));

		this.readingOpenMessage = parseReadingOpenMessage(this.#section('reading_open_message'));

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

		if (sections['mail_recents'] !== undefined && !this.#recentsTimer) {
			this.mailRecents = parseMailRecents(sections['mail_recents']);
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
	}

	#section(name: string): Record<string, unknown> {
		return this.#raw.get(name) ?? {};
	}

	async putSection(
		name: string,
		patch: Record<string, unknown>,
		merge = true
	): Promise<Record<string, unknown> | null> {
		if (this.status !== 'ready') throw new Error('account settings are not loaded');
		const acct = this.#accountId;
		const body = merge ? { ...this.#section(name), ...patch } : { ...patch };
		await putAccountSettingsSection(name, body);
		if (this.#accountId !== acct) return null;
		this.#raw.set(name, body);
		return body;
	}

	async persistReadingOpenMessage(markRead: MarkReadOption): Promise<void> {
		const body = await this.putSection('reading_open_message', {
			markRead: MARK_READ_DELAYS[markRead]
		});
		if (body) this.readingOpenMessage = parseReadingOpenMessage(body);
	}

	async persistPrivacy(next: PrivacySettings): Promise<void> {
		const body = await this.putSection('privacy', { ...next });
		if (body) this.privacy = { ...next };
	}

	async persistShareSpamHeaders(share: boolean): Promise<void> {
		await this.persistPrivacy({ ...this.privacy, shareSpamHeaders: share });
	}

	async persistComposing(next: ComposingSettings): Promise<void> {
		const body = await this.putSection('composing', { ...next });
		if (body) this.composing = { ...next };
	}

	async persistLocalization(next: LocaleSettings): Promise<void> {
		const body = await this.putSection('localization', { ...next });
		if (body) locale.set({ ...next });
	}

	applyTheme(pref: ThemePref): void {
		this.appearance = { ...this.appearance, theme: pref };
		this.#applyAppearance();
	}

	async persistAppearance(next: AppearanceSettings): Promise<void> {
		await this.putSection('appearance', { theme: next.theme }, false);
	}

	async persistCalendar(next: CalendarSettings): Promise<void> {
		this.calendar = { ...next, hidden: [...next.hidden] };
		await this.putSection('calendar', {
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

	recordRecents(kind: MailRecentKind, used: readonly string[]): void {
		if (used.length === 0) return;
		this.mailRecents = {
			...this.mailRecents,
			[kind]: pushRecents(this.mailRecents[kind], used)
		};
		const acct = this.#accountId;
		if (this.#recentsTimer) clearTimeout(this.#recentsTimer);
		this.#recentsTimer = setTimeout(() => {
			this.#recentsTimer = null;
			if (this.#accountId !== acct) return;
			void putAccountSettingsSection('mail_recents', {
				move: this.mailRecents.move,
				labels: this.mailRecents.labels
			}).catch(() => {});
		}, SIDEBAR_PERSIST_DELAY_MS);
	}
}

export const accountSettings = new AccountSettingsStore();
