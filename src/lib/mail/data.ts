import type { MessageTrust } from './trust';
import type { MessagePreviewRecipient } from './preview';
import type { AttachmentChip } from './attachments';
import { initialsFor } from './initials';
import { locale } from './locale.svelte';
import { parseAddressList } from './address';

export type LabelId = 'domains' | 'security' | 'family' | 'billing';

export const LABEL_IDS: readonly LabelId[] = ['domains', 'security', 'family', 'billing'];

export function isLabelId(value: string): value is LabelId {
	return (LABEL_IDS as readonly string[]).includes(value);
}

export type MailboxLocation = 'inbox' | 'archive' | 'sent' | 'trash';

export type RouteFolder =
	| 'inbox'
	| 'starred'
	| 'sent'
	| 'drafts'
	| 'scheduled'
	| 'snoozed'
	| 'archive'
	| 'spam'
	| 'trash';

export const ROUTE_FOLDERS: readonly RouteFolder[] = [
	'inbox',
	'starred',
	'sent',
	'drafts',
	'scheduled',
	'snoozed',
	'archive',
	'spam',
	'trash'
];

export function isRouteFolder(value: string): value is RouteFolder {
	return (ROUTE_FOLDERS as readonly string[]).includes(value);
}

export interface Label {
	name: string;
	color: string;
}

export interface Folder {
	id: string;
	label: string;
	more?: boolean;
}

export interface Attachment {
	name: string;
	size: string;
}

export interface ThreadEntry {
	id?: string;
	from: string;
	fromAddr: string;
	bimiDomain?: string;
	to: string;
	recipients?: MessagePreviewRecipient[];
	init: string;
	bg: string;
	fg: string;
	epoch: number;
	trust?: MessageTrust;
	me?: boolean;
	body: string[];
	srcDoc?: string;
	quotedSrcDoc?: string;
	forwarded?: boolean;
	attachments?: AttachmentChip[];
	externalMessageId?: string;
	inReplyTo?: string;
}

export type RsvpStatus = 'accepted' | 'tentative' | 'declined';

export interface Message {
	id: string;
	folder: string;
	direction: 'sent' | 'received';
	from: string;
	fromAddr: string;
	bimiDomain?: string;
	to: string;
	recipients?: MessagePreviewRecipient[];
	init: string;
	bg: string;
	fg: string;
	subj: string;
	labels: LabelId[];
	unread: boolean;
	starred: boolean;
	spam?: boolean;
	snoozedUntil?: string | null;
	prev: string;
	body: string[];
	html?: string;
	attachments?: Attachment[];
	thread?: ThreadEntry[];
	threadCount?: number;
	externalMessageId?: string;
	inReplyTo?: string;
	references?: string[];
	threadRootId?: string;
	rsvpStatus?: RsvpStatus;
	rsvpEventUid?: string;
	event?: import('./render/icalParse').CalendarEvent | null;
	epoch: number;
}

export function plainSubject(s: unknown): string {
	if (s == null) return '';
	return String(s).replace(/[\uFE0E\uFE0F\u20D0-\u20FF]/g, '');
}

export const LABELS: Record<LabelId, Label> = {
	domains: { name: 'Domains', color: 'var(--pine-500)' },
	security: { name: 'Security', color: 'var(--brass-600)' },
	family: { name: 'Family', color: 'var(--info-500)' },
	billing: { name: 'Billing', color: 'var(--ink-400)' }
};

export const FOLDERS: Folder[] = [
	{ id: 'inbox', label: 'Inbox' },
	{ id: 'starred', label: 'Starred' },
	{ id: 'sent', label: 'Sent' },
	{ id: 'drafts', label: 'Drafts' },
	{ id: 'archive', label: 'Archive' },
	{ id: 'snoozed', label: 'Snoozed', more: true },
	{ id: 'scheduled', label: 'Scheduled', more: true },
	{ id: 'spam', label: 'Spam', more: true },
	{ id: 'trash', label: 'Trash', more: true }
];

export function folderFromServer(
	mailboxState: 'inbox' | 'archive' | 'trash' | 'spam' | 'snoozed',
	direction: 'sent' | 'received'
): string {
	if (mailboxState === 'archive') return 'archive';
	if (mailboxState === 'trash') return 'trash';
	if (mailboxState === 'spam') return 'spam';
	if (mailboxState === 'snoozed') return 'snoozed';
	return direction === 'sent' ? 'sent' : 'inbox';
}

export type IdentityKind = 'Default' | 'Identity' | 'Alias';

export interface SendIdentity {
	name: string;
	email: string;
	init: string;
	bg: string;
	fg: string;
	org: string;
	kind: IdentityKind;
}

export interface Contact {
	name: string;
	email: string;
	init: string;
	bg: string;
	fg: string;
}

export interface RecipientChip extends Contact {
	valid: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(value: string): boolean {
	return EMAIL_RE.test(value.trim());
}

export function recipientChip(r: { name?: string; address: string }): RecipientChip {
	return {
		name: r.name ?? '',
		email: r.address,
		init: initialsFor(r.name ?? '', r.address),
		bg: 'var(--pine-100)',
		fg: 'var(--pine-700)',
		valid: isEmail(r.address)
	};
}

export function chipsFromInput(input: string, contacts: readonly Contact[] = []): RecipientChip[] {
	return parseAddressList(input).map((m) => {
		const known = contacts.find((c) => c.email.toLowerCase() === m.address.toLowerCase());
		if (known) return { ...known, valid: true };
		const display = m.name || m.address;
		return {
			name: display,
			email: m.address,
			init: (display[0] || '?').toUpperCase(),
			bg: 'var(--paper-200)',
			fg: 'var(--ink-700)',
			valid: isEmail(m.address)
		};
	});
}

const DAY_BUCKETS = ['Today', 'Earlier this week', 'Earlier'] as const;
export type DayBucket = (typeof DAY_BUCKETS)[number];
export const GROUP_ORDER: readonly DayBucket[] = DAY_BUCKETS;

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

export function bucket(time: string): DayBucket {
	if (/^\d{1,2}:\d{2}$/.test(time)) return 'Today';
	if (WEEKDAYS.has(time)) return 'Earlier this week';
	return 'Earlier';
}

export function bucketFromEpoch(epoch: number, nowMs: number = Date.now()): DayBucket {
	const m = new Date(epoch);
	const n = new Date(nowMs);
	const sameDay =
		m.getFullYear() === n.getFullYear() &&
		m.getMonth() === n.getMonth() &&
		m.getDate() === n.getDate();
	if (sameDay) return 'Today';
	const diffMs = nowMs - epoch;
	const sixDays = 6 * 24 * 60 * 60 * 1000;
	if (diffMs >= 0 && diffMs < sixDays) return 'Earlier this week';
	return 'Earlier';
}

export function formatClock(date: Date): string {
	const h12 = locale.timeFormat === '12';
	return new Intl.DateTimeFormat(h12 ? 'en-US' : 'en-GB', {
		hour: h12 ? 'numeric' : '2-digit',
		minute: '2-digit',
		hour12: h12,
		timeZone: locale.timeZone
	}).format(date);
}

export function formatWeekday(date: Date, long = false): string {
	return new Intl.DateTimeFormat('en-GB', {
		weekday: long ? 'long' : 'short',
		timeZone: locale.timeZone
	}).format(date);
}

export function formatDateShort(date: Date): string {
	const z = locale.timeZone;
	switch (locale.dateFormat) {
		case 'mdy':
			return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: z }).format(
				date
			);
		case 'iso':
			return new Intl.DateTimeFormat('en-CA', {
				month: '2-digit',
				day: '2-digit',
				timeZone: z
			}).format(date);
		default:
			return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: z }).format(
				date
			);
	}
}

export function formatDateLong(date: Date): string {
	const z = locale.timeZone;
	switch (locale.dateFormat) {
		case 'mdy':
			return new Intl.DateTimeFormat('en-US', {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				timeZone: z
			}).format(date);
		case 'iso':
			return new Intl.DateTimeFormat('en-CA', {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				timeZone: z
			}).format(date);
		default:
			return new Intl.DateTimeFormat('en-GB', {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				timeZone: z
			}).format(date);
	}
}

export function formatEventWhen(date: Date): string {
	return `${formatWeekday(date)}, ${formatDateLong(date)}, ${formatClock(date)}`;
}

export function formatRowTime(date: Date, now: Date = new Date()): string {
	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	if (sameDay) {
		return formatClock(date);
	}
	const diffMs = now.getTime() - date.getTime();
	const sixDays = 6 * 24 * 60 * 60 * 1000;
	if (diffMs >= 0 && diffMs < sixDays) {
		return formatWeekday(date);
	}
	return formatDateShort(date);
}

export type SortId = 'newest' | 'oldest';

export interface SortOption {
	id: SortId;
	label: string;
	icon: string;
}

export const SORT_OPTIONS: SortOption[] = [
	{ id: 'newest', label: 'Date — newest first', icon: 'arrow-down' },
	{ id: 'oldest', label: 'Date — oldest first', icon: 'arrow-up' }
];

export interface ListFilters {
	unread: boolean;
	starred: boolean;
	attach: boolean;
	labels: LabelId[];
}

export const EMPTY_FILTERS: ListFilters = {
	unread: false,
	starred: false,
	attach: false,
	labels: []
};

export function countActiveFilters(f: ListFilters): number {
	return (f.unread ? 1 : 0) + (f.starred ? 1 : 0) + (f.attach ? 1 : 0) + f.labels.length;
}

export function sortMessages(list: Message[], sort: SortId): Message[] {
	const arr = list.slice();
	if (sort === 'oldest') {
		arr.sort((a, b) => a.epoch - b.epoch || a.id.localeCompare(b.id));
	} else {
		arr.sort((a, b) => b.epoch - a.epoch || b.id.localeCompare(a.id));
	}
	return arr;
}

export function isDateSort(sort: SortId): boolean {
	return sort === 'newest' || sort === 'oldest';
}

export function formatWhenLong(date: Date, now: Date = new Date()): string {
	const clock = formatClock(date);
	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	if (sameDay) return `Today at ${clock}`;
	const diffMs = now.getTime() - date.getTime();
	const sixDays = 6 * 24 * 60 * 60 * 1000;
	if (diffMs >= 0 && diffMs < sixDays) {
		return `${formatWeekday(date, true)} at ${clock}`;
	}
	return `${formatDateShort(date)} at ${clock}`;
}
