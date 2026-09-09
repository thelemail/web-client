export const ITEM_SCHEMA_VERSION = 1;
export const META_SCHEMA_VERSION = 1;
export const STATE_SCHEMA_VERSION = 1;

export type ItemKind = 'event' | 'task' | 'hold';
export type Privacy = 'private' | 'busy' | 'shared';
export type Partstat = 'needs-action' | 'accepted' | 'tentative' | 'declined';
export type AttendeeRole = 'req' | 'opt';

export interface DateTimeValue {
	dateTime: string;
	timeZone?: string;
}

export interface DateValue {
	date: string;
}

export type WhenValue = DateTimeValue | DateValue;

export interface Attendee {
	email: string;
	name?: string;
	partstat: Partstat;
	role: AttendeeRole;
	internal: boolean;
}

export interface Organizer {
	email: string;
	name?: string;
	internal: boolean;
}

export interface Owner {
	accountId?: string;
	email: string;
	name?: string;
}

export interface Reminder {
	minutesBefore: number;
}

export interface OverridePatch {
	cancelled?: false;
	title?: string;
	notes?: string;
	location?: string;
	videoUrl?: string;
	start?: WhenValue;
	end?: WhenValue;
	attendees?: Attendee[];
	reminders?: Reminder[];
	done?: boolean;
}

export type Override = { cancelled: true } | OverridePatch;

export interface CalendarItem {
	schemaVersion: number;
	id: string;
	kind: ItemKind;
	calendarId: string;
	title: string;
	notes?: string;
	location?: string;
	videoUrl?: string;
	start?: WhenValue;
	end?: WhenValue;
	rrule?: string;
	exdates?: string[];
	overrides?: Record<string, Override>;
	organizer?: Organizer;
	attendees?: Attendee[];
	owner?: Owner;
	due?: WhenValue;
	estimateMinutes?: number;
	done?: boolean;
	rolloverCount?: number;
	privacy: Privacy;
	sourceMessageId?: string;
	threadSubject?: string;
	reminders?: Reminder[];
	uid: string;
	sequence: number;
	createdAt: string;
	updatedAt: string;
}

export interface CalendarMeta {
	schemaVersion: number;
	name: string;
	color: string;
	description?: string;
	defaultPrivacy: Privacy;
}

export interface MemberState {
	schemaVersion: number;
	ack?: { at: string };
	partstat?: Partstat;
	snoozedReminders?: string[];
}

export class ModelError extends Error {
	code: 'unsupported_schema' | 'malformed';
	constructor(code: ModelError['code'], message?: string) {
		super(message ?? code);
		this.code = code;
		this.name = 'ModelError';
	}
}

const KINDS: ItemKind[] = ['event', 'task', 'hold'];
const PRIVACIES: Privacy[] = ['private', 'busy', 'shared'];
const PARTSTATS: Partstat[] = ['needs-action', 'accepted', 'tentative', 'declined'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string): string {
	if (typeof v !== 'string') throw new ModelError('malformed', `${field} must be a string`);
	return v;
}

function optStr(v: unknown, field: string): string | undefined {
	if (v === undefined || v === null) return undefined;
	return str(v, field);
}

function optNum(v: unknown, field: string): number | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v !== 'number' || !Number.isFinite(v)) {
		throw new ModelError('malformed', `${field} must be a number`);
	}
	return v;
}

function optBool(v: unknown): boolean | undefined {
	return typeof v === 'boolean' ? v : undefined;
}

export function isAllDay(w: WhenValue | undefined): w is DateValue {
	return !!w && 'date' in w;
}

export function parseWhen(v: unknown, field: string): WhenValue {
	if (!isRecord(v)) throw new ModelError('malformed', `${field} must be an object`);
	if (typeof v.date === 'string') {
		if (!DATE_RE.test(v.date)) throw new ModelError('malformed', `${field}.date is not a date`);
		return { date: v.date };
	}
	if (typeof v.dateTime === 'string') {
		if (!DATE_TIME_RE.test(v.dateTime)) {
			throw new ModelError('malformed', `${field}.dateTime is not a wall-clock time`);
		}
		const out: DateTimeValue = { dateTime: normalizeWall(v.dateTime) };
		if (typeof v.timeZone === 'string' && v.timeZone) out.timeZone = v.timeZone;
		return out;
	}
	throw new ModelError('malformed', `${field} needs a date or a dateTime`);
}

function optWhen(v: unknown, field: string): WhenValue | undefined {
	if (v === undefined || v === null) return undefined;
	return parseWhen(v, field);
}

export function normalizeWall(s: string): string {
	return s.length === 16 ? `${s}:00` : s;
}

function parseAttendee(v: unknown): Attendee {
	if (!isRecord(v)) throw new ModelError('malformed', 'attendee must be an object');
	const partstat = v.partstat;
	const role = v.role;
	return {
		email: str(v.email, 'attendee.email'),
		name: optStr(v.name, 'attendee.name'),
		partstat: PARTSTATS.includes(partstat as Partstat) ? (partstat as Partstat) : 'needs-action',
		role: role === 'opt' ? 'opt' : 'req',
		internal: v.internal === true
	};
}

function parseAttendees(v: unknown): Attendee[] | undefined {
	if (v === undefined || v === null) return undefined;
	if (!Array.isArray(v)) throw new ModelError('malformed', 'attendees must be a list');
	return v.map(parseAttendee);
}

function parseReminders(v: unknown): Reminder[] | undefined {
	if (v === undefined || v === null) return undefined;
	if (!Array.isArray(v)) throw new ModelError('malformed', 'reminders must be a list');
	return v.map((r) => {
		if (!isRecord(r)) throw new ModelError('malformed', 'reminder must be an object');
		const minutes = optNum(r.minutesBefore, 'reminder.minutesBefore');
		if (minutes === undefined || minutes < 0) {
			throw new ModelError('malformed', 'reminder needs minutesBefore');
		}
		return { minutesBefore: Math.round(minutes) };
	});
}

function parseOverride(v: unknown): Override {
	if (!isRecord(v)) throw new ModelError('malformed', 'override must be an object');
	if (v.cancelled === true) return { cancelled: true };
	const out: OverridePatch = {};
	if (v.title !== undefined) out.title = str(v.title, 'override.title');
	if (v.notes !== undefined) out.notes = str(v.notes, 'override.notes');
	if (v.location !== undefined) out.location = str(v.location, 'override.location');
	if (v.videoUrl !== undefined) out.videoUrl = str(v.videoUrl, 'override.videoUrl');
	if (v.start !== undefined) out.start = parseWhen(v.start, 'override.start');
	if (v.end !== undefined) out.end = parseWhen(v.end, 'override.end');
	if (v.attendees !== undefined) out.attendees = parseAttendees(v.attendees);
	if (v.reminders !== undefined) out.reminders = parseReminders(v.reminders);
	if (typeof v.done === 'boolean') out.done = v.done;
	return out;
}

function strip<T extends object>(obj: T): T {
	for (const key of Object.keys(obj) as (keyof T)[]) {
		if (obj[key] === undefined) delete obj[key];
	}
	return obj;
}

export function parseItem(input: unknown): CalendarItem {
	const v = typeof input === 'string' ? JSON.parse(input) : input;
	if (!isRecord(v)) throw new ModelError('malformed', 'item must be an object');
	if (v.schemaVersion !== ITEM_SCHEMA_VERSION) {
		throw new ModelError('unsupported_schema', `item schema ${String(v.schemaVersion)}`);
	}
	const kind = v.kind;
	if (!KINDS.includes(kind as ItemKind)) throw new ModelError('malformed', 'unknown item kind');
	const privacy = v.privacy;
	if (!PRIVACIES.includes(privacy as Privacy)) {
		throw new ModelError('malformed', 'unknown privacy mode');
	}
	const item: CalendarItem = {
		schemaVersion: ITEM_SCHEMA_VERSION,
		id: str(v.id, 'id'),
		kind: kind as ItemKind,
		calendarId: str(v.calendarId, 'calendarId'),
		title: typeof v.title === 'string' ? v.title : '',
		notes: optStr(v.notes, 'notes'),
		location: optStr(v.location, 'location'),
		videoUrl: optStr(v.videoUrl, 'videoUrl'),
		start: optWhen(v.start, 'start'),
		end: optWhen(v.end, 'end'),
		rrule: optStr(v.rrule, 'rrule'),
		exdates: Array.isArray(v.exdates) ? v.exdates.map((x) => str(x, 'exdate')) : undefined,
		overrides: undefined,
		organizer: undefined,
		attendees: parseAttendees(v.attendees),
		owner: undefined,
		due: optWhen(v.due, 'due'),
		estimateMinutes: optNum(v.estimateMinutes, 'estimateMinutes'),
		done: optBool(v.done),
		rolloverCount: optNum(v.rolloverCount, 'rolloverCount'),
		privacy: privacy as Privacy,
		sourceMessageId: optStr(v.sourceMessageId, 'sourceMessageId'),
		threadSubject: optStr(v.threadSubject, 'threadSubject'),
		reminders: parseReminders(v.reminders),
		uid: str(v.uid, 'uid'),
		sequence: optNum(v.sequence, 'sequence') ?? 0,
		createdAt: str(v.createdAt, 'createdAt'),
		updatedAt: str(v.updatedAt, 'updatedAt')
	};
	if (isRecord(v.overrides)) {
		item.overrides = {};
		for (const [key, value] of Object.entries(v.overrides)) {
			item.overrides[key] = parseOverride(value);
		}
	}
	if (isRecord(v.organizer)) {
		item.organizer = strip({
			email: str(v.organizer.email, 'organizer.email'),
			name: optStr(v.organizer.name, 'organizer.name'),
			internal: v.organizer.internal === true
		});
	}
	if (isRecord(v.owner)) {
		item.owner = strip({
			accountId: optStr(v.owner.accountId, 'owner.accountId'),
			email: str(v.owner.email, 'owner.email'),
			name: optStr(v.owner.name, 'owner.name')
		});
	}
	if (item.kind !== 'task') {
		if (!item.start || !item.end)
			throw new ModelError('malformed', `${item.kind} needs start and end`);
		if (isAllDay(item.start) !== isAllDay(item.end)) {
			throw new ModelError('malformed', 'start and end must both be dates or both be times');
		}
	}
	if (item.start && item.end && isAllDay(item.start) !== isAllDay(item.end)) {
		throw new ModelError('malformed', 'start and end must both be dates or both be times');
	}
	return strip(item);
}

export function serializeItem(item: CalendarItem): string {
	return JSON.stringify(strip({ ...item, schemaVersion: ITEM_SCHEMA_VERSION }));
}

export function parseMeta(input: unknown): CalendarMeta {
	const v = typeof input === 'string' ? JSON.parse(input) : input;
	if (!isRecord(v)) throw new ModelError('malformed', 'meta must be an object');
	if (v.schemaVersion !== META_SCHEMA_VERSION) {
		throw new ModelError('unsupported_schema', `meta schema ${String(v.schemaVersion)}`);
	}
	const privacy = v.defaultPrivacy;
	return strip({
		schemaVersion: META_SCHEMA_VERSION,
		name: str(v.name, 'name'),
		color: typeof v.color === 'string' && v.color ? v.color : '#2E5440',
		description: optStr(v.description, 'description'),
		defaultPrivacy: PRIVACIES.includes(privacy as Privacy) ? (privacy as Privacy) : 'busy'
	});
}

export function serializeMeta(meta: CalendarMeta): string {
	return JSON.stringify(strip({ ...meta, schemaVersion: META_SCHEMA_VERSION }));
}

export function parseState(input: unknown): MemberState {
	const v = typeof input === 'string' ? JSON.parse(input) : input;
	if (!isRecord(v)) throw new ModelError('malformed', 'state must be an object');
	if (v.schemaVersion !== STATE_SCHEMA_VERSION) {
		throw new ModelError('unsupported_schema', `state schema ${String(v.schemaVersion)}`);
	}
	const out: MemberState = { schemaVersion: STATE_SCHEMA_VERSION };
	if (isRecord(v.ack) && typeof v.ack.at === 'string') out.ack = { at: v.ack.at };
	if (PARTSTATS.includes(v.partstat as Partstat)) out.partstat = v.partstat as Partstat;
	if (Array.isArray(v.snoozedReminders)) {
		out.snoozedReminders = v.snoozedReminders.filter((x): x is string => typeof x === 'string');
	}
	return out;
}

export function serializeState(state: MemberState): string {
	return JSON.stringify(strip({ ...state, schemaVersion: STATE_SCHEMA_VERSION }));
}

export function newUid(id: string, domain: string): string {
	return `${id}@${domain || 'thelemail.com'}`;
}
