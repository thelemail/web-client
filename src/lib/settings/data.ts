export type SectionId =
	| 'profile'
	| 'addresses'
	| 'domains'
	| 'sending'
	| 'reading'
	| 'security'
	| 'blocked'
	| 'import'
	| 'notify'
	| 'region'
	| 'appearance'
	| 'account';

export interface SectionMeta {
	id: SectionId;
	icon: string;
	label: string;
}

export const SECTIONS: SectionMeta[] = [
	{ id: 'profile', icon: 'user-round', label: 'Profile' },
	{ id: 'addresses', icon: 'at-sign', label: 'Addresses' },
	{ id: 'domains', icon: 'globe-2', label: 'Custom domains' },
	{ id: 'sending', icon: 'send', label: 'Composing & sending' },
	{ id: 'reading', icon: 'mail-open', label: 'Reading & behaviour' },
	{ id: 'security', icon: 'shield-check', label: 'Security & privacy' },
	{ id: 'blocked', icon: 'user-x', label: 'Blocked senders' },
	{ id: 'import', icon: 'upload', label: 'Import' },
	{ id: 'region', icon: 'globe', label: 'Localization & region' },
	{ id: 'appearance', icon: 'palette', label: 'Appearance' },
	{ id: 'account', icon: 'credit-card', label: 'Account & plan' }
];

export type AccentIntensity = 'subtle' | 'standard' | 'bold';
export type TwoFaSetupMethod = 'totp' | 'key' | 'device';
export type CeremonyKind =
	| 'recovery'
	| 'password'
	| 'twofa'
	| 'keys'
	| 'delete'
	| 'domain'
	| 'address'
	| 'member';

export interface SettingsState {
	displayName: string;
	defaultFrom: string;
	replyTo: string;
	sigReplies: boolean;

	catchAll: boolean;
	catchAllTarget: string;

	composeFormat: 'rich' | 'plain';
	composeFont: string;
	undo: '0' | '5' | '10' | '30';
	autosave: string;
	replyDefault: 'reply' | 'all';
	confirmExternal: boolean;
	confirmSubject: boolean;
	confirmUnencrypted: boolean;
	extEncrypt: 'auto' | 'ask' | 'off';

	density: 'comfortable' | 'compact';
	markRead: string;
	images: 'ask' | 'contacts' | 'always';
	swipe: string;
	requestReceipts: boolean;
	sendReceipts: string;

	stripTrack: boolean;
	rememberDevice: boolean;

	desktop: boolean;
	notifyFor: string;
	notifyContent: 'full' | 'generic';
	sound: boolean;
	badge: boolean;
	digest: boolean;
	digestTime: string;
	quiet: boolean;
	quietFrom: string;
	quietTo: string;

	lang: string;
	tzAuto: boolean;
	tz: string;
	dateFmt: 'dmy' | 'mdy' | 'iso';
	timeFmt: '24' | '12';
	weekStart: 'mon' | 'sun';
	numFmt: string;

	textScale: number;
	readFont: 'sans' | 'serif';
	highContrast: boolean;
	reduceMotion: boolean;
}

export const SETTINGS_DEFAULTS: SettingsState = {
	displayName: '',
	defaultFrom: '',
	replyTo: 'Same as sending identity',
	sigReplies: false,

	catchAll: false,
	catchAllTarget: '',

	composeFormat: 'rich',
	composeFont: 'Hanken Grotesk',
	undo: '10',
	autosave: 'Every few seconds',
	replyDefault: 'reply',
	confirmExternal: true,
	confirmSubject: true,
	confirmUnencrypted: true,
	extEncrypt: 'ask',

	density: 'comfortable',
	markRead: 'After 2 seconds',
	images: 'ask',
	swipe: 'Archive',
	requestReceipts: false,
	sendReceipts: 'Always ask me',

	stripTrack: true,
	rememberDevice: true,

	desktop: true,
	notifyFor: 'Important & known senders',
	notifyContent: 'full',
	sound: false,
	badge: true,
	digest: false,
	digestTime: '08:00',
	quiet: true,
	quietFrom: '22:00',
	quietTo: '07:00',

	lang: 'English',
	tzAuto: true,
	tz: 'UTC',
	dateFmt: 'dmy',
	timeFmt: '24',
	weekStart: 'mon',
	numFmt: '1,234.56 (English)',

	textScale: 100,
	readFont: 'sans',
	highContrast: false,
	reduceMotion: false
};
