import {
	SETTINGS_DEFAULTS,
	type CeremonyKind,
	type SettingsState,
	type TwoFaSetupMethod
} from '$core/settings/data';
import { putAccountSettingsSection } from '$core/api/accountSettings';
import { accountSettings } from './accountSettings.svelte';
import { workspaces } from './workspaces.svelte';
import { twofactor } from './twofactor.svelte';
import { auth } from './auth.svelte';
import { m } from '$paraglide/messages.js';

const OPEN_MESSAGE_SECTION = 'reading_open_message';
const PRIVACY_SECTION = 'privacy';
const LOCALIZATION_SECTION = 'localization';
const COMPOSING_SECTION = 'composing';
const AUTOSAVE_DELAY = 600;
const SAVED_SETTLE_DELAY = 2200;
const TOAST_DELAY = 2400;

const OPEN_MESSAGE_KEYS = ['markRead', 'swipe'] as const satisfies ReadonlyArray<keyof SettingsState>;
const PRIVACY_KEYS = ['stripTrack', 'shareSpamHeaders'] as const satisfies ReadonlyArray<keyof SettingsState>;
const LOCALIZATION_KEYS = ['dateFmt', 'timeFmt'] as const satisfies ReadonlyArray<
	keyof SettingsState
>;
const APPEARANCE_KEYS = ['density'] as const satisfies ReadonlyArray<keyof SettingsState>;
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

function includesKey(keys: ReadonlyArray<keyof SettingsState>, key: keyof SettingsState): boolean {
	return keys.includes(key);
}

class SettingsDraftStore {
	s = $state<SettingsState>({ ...SETTINGS_DEFAULTS });
	saveState = $state<'idle' | 'saving' | 'saved'>('idle');
	toastText = $state<string | null>(null);
	ceremony = $state<CeremonyKind | null>(null);
	ceremonyTwoFaMethod = $state<TwoFaSetupMethod | undefined>(undefined);
	profileDirty = $state(false);
	profileSave = $state<() => Promise<void>>(async () => {});

	#accountId: string | null = null;
	#dirtyOpenMessage = false;
	#dirtyPrivacy = false;
	#shareSpamHeadersTouched = false;
	#dirtyLocalization = false;
	#dirtyAppearance = false;
	#dirtyComposing = false;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	#settleTimer: ReturnType<typeof setTimeout> | undefined;
	#toastTimer: ReturnType<typeof setTimeout> | undefined;
	#flushing = false;
	#flushAgain = false;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		clearTimeout(this.#saveTimer);
		clearTimeout(this.#settleTimer);
		this.s = { ...SETTINGS_DEFAULTS };
		this.saveState = 'idle';
		this.ceremony = null;
		this.ceremonyTwoFaMethod = undefined;
		this.profileDirty = false;
		this.#dirtyOpenMessage = false;
		this.#dirtyPrivacy = false;
		this.#shareSpamHeadersTouched = false;
		this.#dirtyLocalization = false;
		this.#dirtyAppearance = false;
		this.#dirtyComposing = false;
	}

	async hydrate(): Promise<void> {
		await accountSettings.hydrate();
		const open = accountSettings.readingOpenMessage;
		this.s.markRead = open.markRead;
		this.s.swipe = open.swipe;
		this.s.stripTrack = accountSettings.privacy.stripTrackingParams;
		this.s.shareSpamHeaders = accountSettings.privacy.shareSpamHeaders === true;
		const loc = accountSettings.localization;
		this.s.dateFmt = loc.dateFormat;
		this.s.timeFmt = loc.timeFormat;
		this.s.density = accountSettings.appearance.density;
		const composing = accountSettings.composing;
		this.s.confirmExternal = composing.confirmExternal;
		this.s.confirmSubject = composing.confirmSubject;
		this.s.confirmUnencrypted = composing.confirmUnencrypted;
		this.s.replyDefault = composing.replyDefault;
	}

	set = <K extends keyof SettingsState>(key: K, value: SettingsState[K]): void => {
		this.s[key] = value;
		let persisted = false;
		if (includesKey(OPEN_MESSAGE_KEYS, key)) persisted = this.#dirtyOpenMessage = true;
		if (includesKey(PRIVACY_KEYS, key)) persisted = this.#dirtyPrivacy = true;
		if (key === 'shareSpamHeaders') this.#shareSpamHeadersTouched = true;
		if (includesKey(LOCALIZATION_KEYS, key)) persisted = this.#dirtyLocalization = true;
		if (includesKey(APPEARANCE_KEYS, key)) persisted = this.#dirtyAppearance = true;
		if (includesKey(COMPOSING_KEYS, key)) persisted = this.#dirtyComposing = true;
		if (!persisted) return;
		this.scheduleAutosave();
	};

	scheduleAutosave = (): void => {
		this.saveState = 'saving';
		clearTimeout(this.#saveTimer);
		clearTimeout(this.#settleTimer);
		this.#saveTimer = setTimeout(() => void this.flushAll(), AUTOSAVE_DELAY);
	};

	flushPending = (): void => {
		if (!this.#hasPendingWork()) return;
		clearTimeout(this.#saveTimer);
		void this.flushAll();
	};

	#hasPendingWork(): boolean {
		return (
			this.#dirtyOpenMessage ||
			this.#dirtyPrivacy ||
			this.#dirtyLocalization ||
			this.#dirtyAppearance ||
			this.#dirtyComposing ||
			this.profileDirty
		);
	}

	async flushAll(): Promise<void> {
		if (this.#flushing) {
			this.#flushAgain = true;
			return;
		}
		this.#flushing = true;
		const openMessageBody = this.#dirtyOpenMessage
			? { markRead: this.s.markRead, swipe: this.s.swipe }
			: null;
		const privacyBody = this.#dirtyPrivacy
			? {
					stripTrackingParams: this.s.stripTrack,
					shareSpamHeaders: this.#shareSpamHeadersTouched
						? this.s.shareSpamHeaders
						: accountSettings.privacy.shareSpamHeaders
				}
			: null;
		const localizationBody = this.#dirtyLocalization
			? { dateFormat: this.s.dateFmt, timeFormat: this.s.timeFmt }
			: null;
		const composingBody = this.#dirtyComposing
			? {
					confirmExternal: this.s.confirmExternal,
					confirmSubject: this.s.confirmSubject,
					confirmUnencrypted: this.s.confirmUnencrypted,
					replyDefault: this.s.replyDefault
				}
			: null;
		const appearanceDirty = this.#dirtyAppearance;
		const profileNeedsSave = this.profileDirty;
		try {
			const tasks: Promise<unknown>[] = [];
			if (appearanceDirty) {
				tasks.push(
					accountSettings.persistAppearance({
						...accountSettings.appearance,
						density: this.s.density
					})
				);
			}
			if (openMessageBody) {
				tasks.push(putAccountSettingsSection(OPEN_MESSAGE_SECTION, openMessageBody));
			}
			if (privacyBody) {
				tasks.push(putAccountSettingsSection(PRIVACY_SECTION, privacyBody));
			}
			if (localizationBody) {
				tasks.push(putAccountSettingsSection(LOCALIZATION_SECTION, localizationBody));
			}
			if (composingBody) {
				tasks.push(putAccountSettingsSection(COMPOSING_SECTION, composingBody));
			}
			if (profileNeedsSave) {
				tasks.push(this.profileSave());
			}
			await Promise.all(tasks);
			if (openMessageBody) {
				accountSettings.setReadingOpenMessage(openMessageBody);
				this.#dirtyOpenMessage = false;
			}
			if (privacyBody) {
				accountSettings.setPrivacy(privacyBody);
				this.#dirtyPrivacy = false;
			}
			if (localizationBody) {
				accountSettings.setLocalization(localizationBody);
				this.#dirtyLocalization = false;
			}
			if (composingBody) {
				accountSettings.setComposing(composingBody);
				this.#dirtyComposing = false;
			}
			if (appearanceDirty) {
				this.#dirtyAppearance = false;
			}
			if (!this.#flushAgain) {
				this.saveState = 'saved';
				clearTimeout(this.#settleTimer);
				this.#settleTimer = setTimeout(() => {
					if (this.saveState === 'saved') this.saveState = 'idle';
				}, SAVED_SETTLE_DELAY);
			}
		} catch (err) {
			this.saveState = 'idle';
			this.flash(err instanceof Error ? err.message : m.store_settings_save_failed());
		} finally {
			this.#flushing = false;
			if (this.#flushAgain) {
				this.#flushAgain = false;
				this.scheduleAutosave();
			}
		}
	}

	flash = (text: string): void => {
		this.toastText = text;
		clearTimeout(this.#toastTimer);
		this.#toastTimer = setTimeout(() => (this.toastText = null), TOAST_DELAY);
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
