import {
	SETTINGS_DEFAULTS,
	type CeremonyKind,
	type SettingsState,
	type TwoFaSetupMethod
} from '$lib/settings/data';
import { putAccountSettingsSection } from '$lib/api/accountSettings';
import { accountSettings } from './accountSettings.svelte';
import { customDomains } from './customDomains.svelte';
import { workspaces } from './workspaces.svelte';
import { twofactor } from './twofactor.svelte';
import { auth } from './auth.svelte';

const OPEN_MESSAGE_SECTION = 'reading_open_message';
const PRIVACY_SECTION = 'privacy';
const LOCALIZATION_SECTION = 'localization';
const AUTOSAVE_DELAY = 600;
const SAVED_SETTLE_DELAY = 2200;
const TOAST_DELAY = 2400;

const OPEN_MESSAGE_KEYS = ['markRead', 'swipe'] as const satisfies ReadonlyArray<keyof SettingsState>;
const PRIVACY_KEYS = ['stripTrack'] as const satisfies ReadonlyArray<keyof SettingsState>;
const LOCALIZATION_KEYS = ['dateFmt', 'timeFmt'] as const satisfies ReadonlyArray<
	keyof SettingsState
>;
const APPEARANCE_KEYS = ['density'] as const satisfies ReadonlyArray<keyof SettingsState>;

const CEREMONY_MESSAGES: Record<CeremonyKind, string> = {
	recovery: 'Recovery set up',
	password: 'Password changed',
	twofa: 'Two-factor updated',
	keys: 'Key rotated',
	delete: 'Account scheduled for deletion',
	domain: 'Domain added',
	address: 'Address added',
	member: ''
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
	#dirtyLocalization = false;
	#dirtyAppearance = false;
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
		this.#dirtyLocalization = false;
		this.#dirtyAppearance = false;
	}

	async hydrate(): Promise<void> {
		await accountSettings.hydrate();
		const open = accountSettings.readingOpenMessage;
		this.s.markRead = open.markRead;
		this.s.swipe = open.swipe;
		this.s.stripTrack = accountSettings.privacy.stripTrackingParams;
		const loc = accountSettings.localization;
		this.s.dateFmt = loc.dateFormat;
		this.s.timeFmt = loc.timeFormat;
		this.s.density = accountSettings.appearance.density;
	}

	set = <K extends keyof SettingsState>(key: K, value: SettingsState[K]): void => {
		this.s[key] = value;
		if (includesKey(OPEN_MESSAGE_KEYS, key)) this.#dirtyOpenMessage = true;
		if (includesKey(PRIVACY_KEYS, key)) this.#dirtyPrivacy = true;
		if (includesKey(LOCALIZATION_KEYS, key)) this.#dirtyLocalization = true;
		if (includesKey(APPEARANCE_KEYS, key)) this.#dirtyAppearance = true;
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
		const privacyBody = this.#dirtyPrivacy ? { stripTrackingParams: this.s.stripTrack } : null;
		const localizationBody = this.#dirtyLocalization
			? { dateFormat: this.s.dateFmt, timeFormat: this.s.timeFmt }
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
			if (profileNeedsSave) {
				tasks.push(this.profileSave());
			}
			await Promise.all(tasks);
			if (openMessageBody) {
				accountSettings.setReadingOpenMessage(openMessageBody);
				this.#dirtyOpenMessage = false;
			}
			if (privacyBody) {
				accountSettings.setPrivacy({ stripTrackingParams: privacyBody.stripTrackingParams });
				this.#dirtyPrivacy = false;
			}
			if (localizationBody) {
				accountSettings.setLocalization(localizationBody);
				this.#dirtyLocalization = false;
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
			this.flash(err instanceof Error ? err.message : 'Could not save — try again');
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
		if (kind === 'domain') {
			void customDomains.load(workspaces.workspace?.id ?? null);
		}
		let msg = CEREMONY_MESSAGES[kind];
		if (kind === 'member') {
			msg = workspaces.workspace?.type === 'business' ? 'Member added · seat created' : 'Invitation sent';
			workspaces.loadActiveDetails(auth.accountId);
		}
		this.flash(msg || 'Done');
	};
}

export const settingsDraft = new SettingsDraftStore();
