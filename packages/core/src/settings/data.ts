import { m } from '$paraglide/messages.js';
import type { MarkReadOption } from '$core/stores/accountSettings.svelte';

export type SectionId =
	| 'profile'
	| 'addresses'
	| 'domains'
	| 'sending'
	| 'reading'
	| 'security'
	| 'blocked'
	| 'collections'
	| 'import'
	| 'notify'
	| 'region'
	| 'appearance'
	| 'account'
	| 'about';

export interface SectionMeta {
	id: SectionId;
	icon: string;
	label: () => string;
}

export const SECTIONS: SectionMeta[] = [
	{ id: 'profile', icon: 'user-round', label: m.settings_nav_profile },
	{ id: 'addresses', icon: 'at-sign', label: m.settings_nav_addresses },
	{ id: 'domains', icon: 'globe-2', label: m.settings_nav_domains },
	{ id: 'sending', icon: 'send', label: m.settings_nav_sending },
	{ id: 'reading', icon: 'mail-open', label: m.settings_nav_reading },
	{ id: 'security', icon: 'shield-check', label: m.settings_nav_security },
	{ id: 'blocked', icon: 'user-x', label: m.settings_nav_blocked },
	{ id: 'collections', icon: 'folder-tree', label: m.settings_nav_collections },
	{ id: 'import', icon: 'upload', label: m.settings_nav_import },
	{ id: 'notify', icon: 'bell', label: m.settings_nav_notify },
	{ id: 'region', icon: 'globe', label: m.settings_nav_region },
	{ id: 'appearance', icon: 'palette', label: m.settings_nav_appearance },
	{ id: 'account', icon: 'credit-card', label: m.settings_nav_account },
	{ id: 'about', icon: 'info', label: m.settings_nav_about }
];

export type TwoFaSetupMethod = 'totp' | 'key' | 'device';
export type CeremonyKind =
	| 'recovery'
	| 'password'
	| 'twofa'
	| 'keys'
	| 'delete'
	| 'alias'
	| 'member'
	| 'familyInvite'
	| 'family';

export interface SettingsState {
	replyDefault: 'reply' | 'all';
	confirmExternal: boolean;
	confirmSubject: boolean;
	confirmUnencrypted: boolean;

	markRead: MarkReadOption;

	stripTrack: boolean;
	shareSpamHeaders: boolean;

	dateFmt: 'dmy' | 'mdy' | 'iso';
	timeFmt: '24' | '12';
}

export const SETTINGS_DEFAULTS: SettingsState = {
	replyDefault: 'reply',
	confirmExternal: true,
	confirmSubject: true,
	confirmUnencrypted: true,

	markRead: 'after_2s',

	stripTrack: true,
	shareSpamHeaders: false,

	dateFmt: 'dmy',
	timeFmt: '24'
};

export function sectionIdFromPath(pathname: string): string {
	const parts = pathname.split('/').filter(Boolean);
	const i = parts.indexOf('settings');
	return (i === -1 ? parts.at(-1) : parts[i + 1]) ?? '';
}

export function sectionLabelFromPath(pathname: string): string {
	const id = sectionIdFromPath(pathname);
	return SECTIONS.find((sec) => sec.id === id)?.label() ?? m.settings_nav_fallback();
}
