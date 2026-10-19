import {
	SETTINGS_DEFAULTS,
	type CeremonyKind,
	type SettingsState,
	type TwoFaSetupMethod
} from '$core/settings/data';
import { accountSettings } from './accountSettings.svelte';
import type { ThemePref } from './theme.svelte';
import { workspaces } from './workspaces.svelte';
import { twofactor } from './twofactor.svelte';
import { auth } from './auth.svelte';
import { m } from '$paraglide/messages.js';
import { announce } from '$core/announce';

const AUTOSAVE_DELAY = 600;
const SAVED_SETTLE_DELAY = 2200;
const TOAST_DELAY = 2400;
const RETRY_BASE_DELAY = 2000;
const RETRY_MAX_DELAY = 30000;

const OPEN_MESSAGE_KEYS = ['markRead'] as const satisfies ReadonlyArray<keyof SettingsState>;
const PRIVACY_KEYS = ['stripTrack', 'shareSpamHeaders'] as const satisfies ReadonlyArray<keyof SettingsState>;
const LOCALIZATION_KEYS = ['dateFmt', 'timeFmt'] as const satisfies ReadonlyArray<
	keyof SettingsState
>;
const COMPOSING_KEYS = [
	'confirmExternal',
	'confirmSubject',
	'confirmUnencrypted',
	'replyDefault'
] as const satisfies ReadonlyArray<keyof SettingsState>;

const CEREMONY_MESSAGES: Record<CeremonyKind, () => string> = {
	recovery: () => m.store_ceremony_done_recovery(),
	password: () => m.store_ceremony_done_password(),
	twofa: () => m.store_ceremony_done_twofa(),
	keys: () => m.store_ceremony_done_keys(),
	delete: () => m.store_ceremony_done_delete(),
	alias: () => m.store_ceremony_done_alias(),
	member: () => '',
	familyInvite: () => m.store_ceremony_done_family_invite(),
	family: () => m.store_ceremony_done_family()
};

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';
export type ToastKind = 'success' | 'error';

interface SaveJob {
	run: () => Promise<unknown>;
	restore: () => void;
	explains?: boolean;
}

type DraftKey = keyof SettingsState | 'theme' | 'reminder';

const SECTION_KEYS: ReadonlyArray<keyof SettingsState> = [
	...OPEN_MESSAGE_KEYS,
	...PRIVACY_KEYS,
	...LOCALIZATION_KEYS,
	...COMPOSING_KEYS
];

class SettingsDraftStore {
	s = $state<SettingsState>({ ...SETTINGS_DEFAULTS });
	saveState = $state<SaveState>('idle');
	toast = $state<{ text: string; kind: ToastKind } | null>(null);
	ceremony = $state<CeremonyKind | null>(null);
	ceremonyTwoFaMethod = $state<TwoFaSetupMethod | undefined>(undefined);
	profileDirty = $state(false);
	profileSave = $state<() => Promise<void>>(async () => {});

	#accountId: string | null = null;
	#synced = false;
	#edited = new Set<DraftKey>();
	#inFlight = new Set<DraftKey>();
	#pendingTheme: ThemePref = 'light';
	#pendingReminder: number | null = null;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	#settleTimer: ReturnType<typeof setTimeout> | undefined;
	#toastTimer: ReturnType<typeof setTimeout> | undefined;
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#retryDelay = RETRY_BASE_DELAY;
	#failing = false;
	#flushing = false;
	#flushAgain = false;

	constructor() {
		accountSettings.onLoaded(() => this.#onLoaded());
		if (typeof window !== 'undefined') window.addEventListener('online', this.#onOnline);
	}

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		clearTimeout(this.#saveTimer);
		clearTimeout(this.#settleTimer);
		clearTimeout(this.#retryTimer);
		clearTimeout(this.#toastTimer);
		this.s = { ...SETTINGS_DEFAULTS };
		this.saveState = 'idle';
		this.toast = null;
		this.ceremony = null;
		this.ceremonyTwoFaMethod = undefined;
		this.profileDirty = false;
		this.#synced = false;
		this.#edited = new Set();
		this.#inFlight = new Set();
		this.#retryDelay = RETRY_BASE_DELAY;
		this.#failing = false;
	}

	async hydrate(): Promise<void> {
		await accountSettings.hydrate();
		if (accountSettings.status === 'ready' && !this.#synced) this.#onLoaded();
		if (accountSettings.status === 'error' && this.#hasSectionWork()) this.saveState = 'error';
	}

	retryLoad = (): Promise<void> => this.hydrate();

	#onLoaded(): void {
		if (accountSettings.accountId !== this.#accountId) return;
		this.#synced = true;
		this.#sync();
		if (this.#hasSectionWork() && !this.#flushing && !this.#failing) {
			clearTimeout(this.#saveTimer);
			void this.flushAll();
		}
	}

	#sync(): void {
		const composing = accountSettings.composing;
		const server: Partial<SettingsState> = {
			markRead: accountSettings.readingOpenMessage.markRead,
			stripTrack: accountSettings.privacy.stripTrackingParams,
			shareSpamHeaders: accountSettings.privacy.shareSpamHeaders === true,
			dateFmt: accountSettings.localization.dateFormat,
			timeFmt: accountSettings.localization.timeFormat,
			confirmExternal: composing.confirmExternal,
			confirmSubject: composing.confirmSubject,
			confirmUnencrypted: composing.confirmUnencrypted,
			replyDefault: composing.replyDefault
		};
		for (const key of SECTION_KEYS) {
			if (!this.#unsaved(key)) this.#copy(key, server);
		}
		if (this.#unsaved('theme')) accountSettings.applyTheme(this.#pendingTheme);
		if (this.#unsaved('reminder')) {
			accountSettings.calendar = {
				...accountSettings.calendar,
				defaultReminderMinutes: this.#pendingReminder
			};
		}
	}

	#unsaved(key: DraftKey): boolean {
		return this.#edited.has(key) || this.#inFlight.has(key);
	}

	#copy<K extends keyof SettingsState>(key: K, from: Partial<SettingsState>): void {
		const value = from[key];
		if (value !== undefined) this.s[key] = value as SettingsState[K];
	}

	#onOnline = (): void => {
		if (accountSettings.status === 'error') {
			void this.hydrate();
			return;
		}
		if (this.saveState === 'error') this.retrySave();
	};

	set = <K extends keyof SettingsState>(key: K, value: SettingsState[K]): void => {
		this.s[key] = value;
		if (!SECTION_KEYS.includes(key)) return;
		this.#edited.add(key);
		this.scheduleAutosave();
	};

	setTheme = (pref: ThemePref): void => {
		accountSettings.applyTheme(pref);
		this.#pendingTheme = pref;
		this.#edited.add('theme');
		this.scheduleAutosave();
	};

	setReminderDefault = (minutes: number | null): void => {
		accountSettings.calendar = {
			...accountSettings.calendar,
			defaultReminderMinutes: minutes
		};
		this.#pendingReminder = minutes;
		this.#edited.add('reminder');
		this.scheduleAutosave();
	};

	scheduleAutosave = (): void => {
		this.saveState = 'saving';
		clearTimeout(this.#saveTimer);
		clearTimeout(this.#settleTimer);
		clearTimeout(this.#retryTimer);
		this.#saveTimer = setTimeout(() => void this.flushAll(), AUTOSAVE_DELAY);
	};

	flushPending = (): void => {
		if (!this.#hasPendingWork()) return;
		clearTimeout(this.#saveTimer);
		void this.flushAll();
	};

	retrySave = (): void => {
		clearTimeout(this.#retryTimer);
		this.#retryDelay = RETRY_BASE_DELAY;
		if (accountSettings.status === 'error') {
			this.saveState = 'saving';
			void this.hydrate();
			return;
		}
		this.flushPending();
	};

	#hasSectionWork(): boolean {
		return this.#edited.size > 0;
	}

	#hasPendingWork(): boolean {
		return this.#hasSectionWork() || this.profileDirty;
	}

	#takeKeys(
		jobs: SaveJob[],
		keys: ReadonlyArray<DraftKey>,
		persist: (edited: ReadonlySet<DraftKey>) => Promise<unknown>
	): void {
		const edited = new Set(keys.filter((key) => this.#edited.has(key)));
		if (edited.size === 0) return;
		for (const key of edited) {
			this.#edited.delete(key);
			this.#inFlight.add(key);
		}
		const acct = this.#accountId;
		jobs.push({
			run: async () => {
				try {
					return await persist(edited);
				} finally {
					if (this.#accountId === acct) for (const key of edited) this.#inFlight.delete(key);
				}
			},
			restore: () => {
				for (const key of edited) this.#edited.add(key);
			}
		});
	}

	#takeSectionJobs(): SaveJob[] {
		const jobs: SaveJob[] = [];
		const s = this.s;
		this.#takeKeys(jobs, OPEN_MESSAGE_KEYS, () =>
			accountSettings.persistReadingOpenMessage(s.markRead)
		);
		this.#takeKeys(jobs, PRIVACY_KEYS, (edited) => {
			const next = { ...accountSettings.privacy };
			if (edited.has('stripTrack')) next.stripTrackingParams = s.stripTrack;
			if (edited.has('shareSpamHeaders')) next.shareSpamHeaders = s.shareSpamHeaders;
			return accountSettings.persistPrivacy(next);
		});
		this.#takeKeys(jobs, LOCALIZATION_KEYS, (edited) => {
			const next = { ...accountSettings.localization };
			if (edited.has('dateFmt')) next.dateFormat = s.dateFmt;
			if (edited.has('timeFmt')) next.timeFormat = s.timeFmt;
			return accountSettings.persistLocalization(next);
		});
		this.#takeKeys(jobs, COMPOSING_KEYS, (edited) => {
			const next = { ...accountSettings.composing };
			if (edited.has('confirmExternal')) next.confirmExternal = s.confirmExternal;
			if (edited.has('confirmSubject')) next.confirmSubject = s.confirmSubject;
			if (edited.has('confirmUnencrypted')) next.confirmUnencrypted = s.confirmUnencrypted;
			if (edited.has('replyDefault')) next.replyDefault = s.replyDefault;
			return accountSettings.persistComposing(next);
		});
		const theme = this.#pendingTheme;
		this.#takeKeys(jobs, ['theme'], () => accountSettings.persistAppearance({ theme }));
		const reminder = this.#pendingReminder;
		this.#takeKeys(jobs, ['reminder'], () =>
			accountSettings.persistCalendar({
				...accountSettings.calendar,
				defaultReminderMinutes: reminder
			})
		);
		return jobs;
	}

	async flushAll(): Promise<void> {
		if (this.#flushing) {
			this.#flushAgain = true;
			return;
		}
		const acct = this.#accountId;
		const jobs = accountSettings.status === 'ready' ? this.#takeSectionJobs() : [];
		if (this.profileDirty) {
			jobs.push({ run: () => this.profileSave(), restore: () => {}, explains: true });
		}
		if (jobs.length === 0) {
			this.#settleWithoutJobs();
			return;
		}
		this.#flushing = true;
		this.saveState = 'saving';
		clearTimeout(this.#settleTimer);
		let failed = false;
		try {
			const results = await Promise.allSettled(jobs.map((job) => job.run()));
			if (this.#accountId !== acct) return;
			results.forEach((r, i) => {
				if (r.status === 'rejected') jobs[i].restore();
			});
			const rejected = results.findIndex((r) => r.status === 'rejected');
			if (rejected >= 0) {
				failed = true;
				const reason = (results[rejected] as PromiseRejectedResult).reason;
				this.#fail(jobs[rejected].explains && reason instanceof Error ? reason.message : null);
			} else if (!this.#flushAgain) {
				this.#succeed();
			}
		} finally {
			this.#flushing = false;
			const again = this.#flushAgain;
			this.#flushAgain = false;
			if (again && !failed) this.scheduleAutosave();
		}
	}

	#settleWithoutJobs(): void {
		if (this.#hasSectionWork()) {
			if (accountSettings.status === 'error') this.saveState = 'error';
			return;
		}
		if (this.saveState === 'saving') this.saveState = 'idle';
	}

	#succeed(): void {
		clearTimeout(this.#retryTimer);
		this.#retryDelay = RETRY_BASE_DELAY;
		this.#failing = false;
		if (this.#hasSectionWork()) {
			this.scheduleAutosave();
			return;
		}
		this.saveState = 'saved';
		this.#settleTimer = setTimeout(() => {
			if (this.saveState === 'saved') this.saveState = 'idle';
		}, SAVED_SETTLE_DELAY);
	}

	#fail(message: string | null): void {
		this.saveState = 'error';
		if (!this.#failing) {
			this.#failing = true;
			this.flash(message || m.settings_save_failed(), 'error');
		}
		clearTimeout(this.#retryTimer);
		const delay = this.#retryDelay;
		this.#retryDelay = Math.min(delay * 2, RETRY_MAX_DELAY);
		this.#retryTimer = setTimeout(() => {
			if (this.#hasPendingWork()) void this.flushAll();
		}, delay);
	}

	flash = (text: string, kind: ToastKind = 'success'): void => {
		this.toast = { text, kind };
		announce(text, { assertive: kind === 'error' });
		clearTimeout(this.#toastTimer);
		this.#toastTimer = setTimeout(() => (this.toast = null), TOAST_DELAY);
	};

	launch = (kind: CeremonyKind, opts?: { method?: TwoFaSetupMethod }): void => {
		this.ceremonyTwoFaMethod = opts?.method;
		this.ceremony = kind;
	};

	close = (): void => {
		this.ceremony = null;
	};

	complete = async (kind: CeremonyKind): Promise<void> => {
		if (kind === 'recovery') void auth.loadProfile();
		if (kind === 'twofa') {
			twofactor.invalidate();
			void twofactor.load();
		}
		let msg = CEREMONY_MESSAGES[kind]();
		if (kind === 'member') {
			msg =
				workspaces.workspace?.type === 'business'
					? m.store_ceremony_done_member_business()
					: m.store_ceremony_done_family_invite();
			workspaces.loadActiveDetails(auth.accountId);
		}
		if (kind === 'familyInvite' || kind === 'family') {
			workspaces.loadActiveDetails(auth.accountId);
		}
		this.flash(msg || m.common_done());
	};
}

export const settingsDraft = new SettingsDraftStore();
