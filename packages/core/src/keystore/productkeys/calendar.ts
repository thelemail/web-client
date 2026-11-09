import type * as openpgp from 'openpgp';
import type { Json } from './canonical';
import { decodeCanonical, encodeCanonical } from './canonical';
import { b64encode, bytesEqual, isCanonicalUuid, keyId } from './encoding';
import { fail, ProductKeysError } from './errors';
import type { Obj } from './fields';
import { array, bin, exact, hash, id, int, MAX_RECORD_BYTES, sortedUnique, str, timestamp } from './fields';
import type { Delegation } from './manifests';
import { DOMAIN, parseDelegation } from './manifests';
import { fingerprintBytes, parsePublicKey, publicKeyDigest, validateProfile, verifyTranscript } from './pgp';
import { PROFILE } from './profiles';

export const CALENDAR_TYPE = {
	invitation: 'thelemail-calendar-invitation/v1',
	reply: 'thelemail-calendar-reply/v1',
	freeBusy: 'thelemail-calendar-freebusy/v1',
	grant: 'thelemail-calendar-grant/v1'
} as const;

export type CalendarStatementType = (typeof CALENDAR_TYPE)[keyof typeof CALENDAR_TYPE];

export const CALENDAR_DOMAIN: Record<CalendarStatementType, string> = {
	[CALENDAR_TYPE.invitation]: 'thelemail/calendar-invitation/v1',
	[CALENDAR_TYPE.reply]: 'thelemail/calendar-reply/v1',
	[CALENDAR_TYPE.freeBusy]: 'thelemail/calendar-freebusy/v1',
	[CALENDAR_TYPE.grant]: 'thelemail/calendar-grant/v1'
};

const PURPOSE: Record<CalendarStatementType, string> = {
	[CALENDAR_TYPE.invitation]: 'calendar.invite',
	[CALENDAR_TYPE.reply]: 'calendar.reply',
	[CALENDAR_TYPE.freeBusy]: 'calendar.freebusy',
	[CALENDAR_TYPE.grant]: 'calendar.grant'
};

export const MAX_CALENDAR_RECIPIENTS = 100;
export const MAX_BUSY_WINDOWS = 512;
export const MAX_FREEBUSY_RANGE_MS = 400 * 24 * 60 * 60 * 1000;

const MESSAGE_FIELDS = [
	'accountId', 'calendarId', 'contentDigest', 'delegationRevision', 'eventId', 'issuedAt', 'membershipRevision',
	'method', 'operationId', 'organizerAccountId', 'productKeyEpoch', 'recipients', 'sequence', 'type', 'uid'
];
const FREEBUSY_FIELDS = [
	'accountId', 'calendarId', 'delegationRevision', 'issuedAt', 'itemId', 'privacy', 'productKeyEpoch',
	'rangeEnd', 'rangeStart', 'revision', 'type', 'windows'
];
const GRANT_FIELDS = [
	'accountId', 'calendarId', 'delegationRevision', 'issuedAt', 'keyFingerprint', 'keyVersion', 'memberAccountId',
	'productKeyEpoch', 'recipientPublicKeyDigest', 'role', 'type', 'wrappedKeyDigest'
];
const ROLES = ['editor', 'owner', 'viewer'];
const PRIVACIES = ['busy', 'shared'];

export type CalendarMethod = 'REQUEST' | 'CANCEL' | 'REPLY';

export interface CalendarMessage {
	type: typeof CALENDAR_TYPE.invitation | typeof CALENDAR_TYPE.reply;
	accountId: string;
	organizerAccountId: string;
	calendarId: string;
	eventId: string;
	uid: string;
	method: CalendarMethod;
	sequence: number;
	recipients: string[];
	contentDigest: Uint8Array;
	productKeyEpoch: number;
	delegationRevision: number;
	membershipRevision: number;
	operationId: string;
	issuedAt: string;
}

export interface CalendarFreeBusy {
	accountId: string;
	calendarId: string;
	itemId: string;
	privacy: 'busy' | 'shared';
	revision: number;
	rangeStart: number;
	rangeEnd: number;
	windows: [number, number][];
	productKeyEpoch: number;
	delegationRevision: number;
	issuedAt: string;
}

export interface CalendarGrant {
	accountId: string;
	calendarId: string;
	keyVersion: number;
	keyFingerprint: Uint8Array;
	memberAccountId: string;
	role: 'owner' | 'editor' | 'viewer';
	recipientPublicKeyDigest: Uint8Array;
	wrappedKeyDigest: Uint8Array;
	productKeyEpoch: number;
	delegationRevision: number;
	issuedAt: string;
}

function checkUid(uid: string): void {
	if (uid.length === 0 || uid.length > 255) fail('malformed', 'uid length');
	for (let i = 0; i < uid.length; i++) {
		const c = uid.charCodeAt(i);
		if (c < 0x21 || c > 0x7e) fail('malformed', 'uid characters');
	}
}

function validateMessage(m: CalendarMessage): void {
	for (const v of [m.accountId, m.organizerAccountId, m.calendarId, m.eventId, m.operationId]) {
		if (!isCanonicalUuid(v)) fail('malformed', 'noncanonical uuid');
	}
	checkUid(m.uid);
	if (m.recipients.length === 0 || m.recipients.length > MAX_CALENDAR_RECIPIENTS) fail('malformed', 'recipients');
	for (const r of m.recipients) if (!isCanonicalUuid(r)) fail('malformed', 'noncanonical uuid');
	sortedUnique(m.recipients, (r) => r);
	if (m.contentDigest.length !== 32) fail('malformed', 'hash length');
	if (m.type === CALENDAR_TYPE.invitation) {
		if (m.method !== 'REQUEST' && m.method !== 'CANCEL') fail('malformed', 'invitation method');
		if (m.accountId !== m.organizerAccountId || m.recipients.includes(m.accountId)) fail('malformed', 'invitation organizer');
	} else if (m.type === CALENDAR_TYPE.reply) {
		if (m.method !== 'REPLY') fail('malformed', 'reply method');
		if (m.accountId === m.organizerAccountId || m.recipients.length !== 1 || m.recipients[0] !== m.organizerAccountId) {
			fail('malformed', 'reply recipients');
		}
	} else {
		fail('malformed', 'calendar message type');
	}
}

export function parseCalendarMessage(raw: Uint8Array): CalendarMessage {
	const o = exact(decodeCanonical(raw, MAX_RECORD_BYTES), MESSAGE_FIELDS);
	const m: CalendarMessage = {
		type: str(o, 'type') as CalendarMessage['type'],
		accountId: id(o, 'accountId'),
		organizerAccountId: id(o, 'organizerAccountId'),
		calendarId: id(o, 'calendarId'),
		eventId: id(o, 'eventId'),
		uid: str(o, 'uid'),
		method: str(o, 'method') as CalendarMethod,
		sequence: int(o, 'sequence', 0),
		recipients: array(o, 'recipients').map((r) => {
			if (typeof r !== 'string') fail('malformed', 'recipient');
			return r;
		}),
		contentDigest: hash(o, 'contentDigest'),
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		delegationRevision: int(o, 'delegationRevision', 1),
		membershipRevision: int(o, 'membershipRevision', 0),
		operationId: id(o, 'operationId'),
		issuedAt: timestamp(o, 'issuedAt')
	};
	validateMessage(m);
	return m;
}

export function encodeCalendarMessage(m: CalendarMessage): Uint8Array {
	validateMessage(m);
	const raw = encodeCanonical({
		type: m.type,
		accountId: m.accountId,
		organizerAccountId: m.organizerAccountId,
		calendarId: m.calendarId,
		eventId: m.eventId,
		uid: m.uid,
		method: m.method,
		sequence: m.sequence,
		recipients: m.recipients,
		contentDigest: b64encode(m.contentDigest),
		productKeyEpoch: m.productKeyEpoch,
		delegationRevision: m.delegationRevision,
		membershipRevision: m.membershipRevision,
		operationId: m.operationId,
		issuedAt: m.issuedAt
	});
	parseCalendarMessage(raw);
	return raw;
}

function windows(o: Obj): [number, number][] {
	return array(o, 'windows').map((w) => {
		if (!Array.isArray(w) || w.length !== 2) fail('malformed', 'window');
		const [a, b] = w;
		if (typeof a !== 'number' || typeof b !== 'number' || !Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0) {
			fail('malformed', 'window bounds');
		}
		return [a, b];
	});
}

function validateFreeBusy(f: CalendarFreeBusy): void {
	for (const v of [f.accountId, f.calendarId, f.itemId]) if (!isCanonicalUuid(v)) fail('malformed', 'noncanonical uuid');
	if (!PRIVACIES.includes(f.privacy)) fail('malformed', 'free/busy privacy');
	if (f.rangeEnd <= f.rangeStart || f.rangeEnd - f.rangeStart > MAX_FREEBUSY_RANGE_MS) fail('malformed', 'free/busy range');
	if (f.windows.length > MAX_BUSY_WINDOWS) fail('malformed', 'free/busy windows');
	f.windows.forEach(([a, b], i) => {
		if (b <= a || b <= f.rangeStart || a >= f.rangeEnd) fail('malformed', 'free/busy window');
		if (i > 0 && a <= f.windows[i - 1][1]) fail('malformed', 'free/busy windows are not sorted and disjoint');
	});
}

export function parseCalendarFreeBusy(raw: Uint8Array): CalendarFreeBusy {
	const o = exact(decodeCanonical(raw, MAX_RECORD_BYTES), FREEBUSY_FIELDS);
	if (str(o, 'type') !== CALENDAR_TYPE.freeBusy) fail('malformed', 'free/busy type');
	const f: CalendarFreeBusy = {
		accountId: id(o, 'accountId'),
		calendarId: id(o, 'calendarId'),
		itemId: id(o, 'itemId'),
		privacy: str(o, 'privacy') as CalendarFreeBusy['privacy'],
		revision: int(o, 'revision', 1),
		rangeStart: int(o, 'rangeStart', 0),
		rangeEnd: int(o, 'rangeEnd', 0),
		windows: windows(o),
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		delegationRevision: int(o, 'delegationRevision', 1),
		issuedAt: timestamp(o, 'issuedAt')
	};
	validateFreeBusy(f);
	return f;
}

export function encodeCalendarFreeBusy(f: CalendarFreeBusy): Uint8Array {
	validateFreeBusy(f);
	const raw = encodeCanonical({
		type: CALENDAR_TYPE.freeBusy,
		accountId: f.accountId,
		calendarId: f.calendarId,
		itemId: f.itemId,
		privacy: f.privacy,
		revision: f.revision,
		rangeStart: f.rangeStart,
		rangeEnd: f.rangeEnd,
		windows: f.windows as Json,
		productKeyEpoch: f.productKeyEpoch,
		delegationRevision: f.delegationRevision,
		issuedAt: f.issuedAt
	});
	parseCalendarFreeBusy(raw);
	return raw;
}

function validateGrant(g: CalendarGrant): void {
	for (const v of [g.accountId, g.calendarId, g.memberAccountId]) if (!isCanonicalUuid(v)) fail('malformed', 'noncanonical uuid');
	if (!ROLES.includes(g.role)) fail('malformed', 'grant role');
	if (g.keyFingerprint.length !== 32) fail('malformed', 'calendar key fingerprint');
	if (g.recipientPublicKeyDigest.length !== 32 || g.wrappedKeyDigest.length !== 32) fail('malformed', 'hash length');
}

export function parseCalendarGrant(raw: Uint8Array): CalendarGrant {
	const o = exact(decodeCanonical(raw, MAX_RECORD_BYTES), GRANT_FIELDS);
	if (str(o, 'type') !== CALENDAR_TYPE.grant) fail('malformed', 'grant type');
	const g: CalendarGrant = {
		accountId: id(o, 'accountId'),
		calendarId: id(o, 'calendarId'),
		keyVersion: int(o, 'keyVersion', 1),
		keyFingerprint: bin(o, 'keyFingerprint', 32),
		memberAccountId: id(o, 'memberAccountId'),
		role: str(o, 'role') as CalendarGrant['role'],
		recipientPublicKeyDigest: hash(o, 'recipientPublicKeyDigest'),
		wrappedKeyDigest: hash(o, 'wrappedKeyDigest'),
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		delegationRevision: int(o, 'delegationRevision', 1),
		issuedAt: timestamp(o, 'issuedAt')
	};
	validateGrant(g);
	return g;
}

export function encodeCalendarGrant(g: CalendarGrant): Uint8Array {
	validateGrant(g);
	const raw = encodeCanonical({
		type: CALENDAR_TYPE.grant,
		accountId: g.accountId,
		calendarId: g.calendarId,
		keyVersion: g.keyVersion,
		keyFingerprint: b64encode(g.keyFingerprint),
		memberAccountId: g.memberAccountId,
		role: g.role,
		recipientPublicKeyDigest: b64encode(g.recipientPublicKeyDigest),
		wrappedKeyDigest: b64encode(g.wrappedKeyDigest),
		productKeyEpoch: g.productKeyEpoch,
		delegationRevision: g.delegationRevision,
		issuedAt: g.issuedAt
	});
	parseCalendarGrant(raw);
	return raw;
}

export interface CalendarAuthority {
	accountId: string;
	authorityKey: openpgp.PublicKey;
	signingKey: openpgp.PublicKey;
	signingKeyDigest: Uint8Array;
	delegation: Delegation;
}

async function rethrow<T>(p: Promise<T> | (() => T)): Promise<T> {
	try {
		return typeof p === 'function' ? p() : await p;
	} catch (err) {
		if (err instanceof ProductKeysError && err.code === 'authority') throw err;
		fail('authority', err instanceof Error ? err.message : undefined);
	}
}

export async function calendarAuthority(
	accountId: string,
	authorityKeyRaw: Uint8Array,
	authorityEpoch: number,
	delegationRecord: Uint8Array,
	delegationSignature: Uint8Array,
	signingKeyRaw: Uint8Array
): Promise<CalendarAuthority> {
	if (!isCanonicalUuid(accountId)) fail('authority', 'account id');
	const authorityKey = await rethrow(parsePublicKey(authorityKeyRaw));
	await rethrow(validateProfile(PROFILE.accountAuthority, authorityKey));
	const signingKey = await rethrow(parsePublicKey(signingKeyRaw));
	await rethrow(validateProfile(PROFILE.calendarIdentity, signingKey));
	const delegation = await rethrow(() => parseDelegation(delegationRecord));
	const signingKeyDigest = await publicKeyDigest(signingKey);
	const calId = keyId(accountId, fingerprintBytes(signingKey));
	const aakId = keyId(accountId, fingerprintBytes(authorityKey));
	if (
		delegation.product !== 'calendar' ||
		delegation.accountId !== accountId ||
		delegation.authorityEpoch !== authorityEpoch ||
		delegation.authorityKeyId !== aakId ||
		delegation.signingKeyId !== calId ||
		delegation.recipientKeyId !== calId ||
		delegation.signingProfileId !== PROFILE.calendarIdentity ||
		delegation.recipientProfileId !== PROFILE.calendarIdentity ||
		!bytesEqual(delegation.signingPublicKeyDigest, signingKeyDigest) ||
		!bytesEqual(delegation.recipientPublicKeyDigest, signingKeyDigest)
	) {
		fail('authority', 'delegation does not name this authority and key');
	}
	await rethrow(verifyTranscript(DOMAIN.delegation, delegationRecord, delegationSignature, authorityKey));
	return { accountId, authorityKey, signingKey, signingKeyDigest, delegation };
}

function check(a: CalendarAuthority, type: CalendarStatementType, accountId: string, productKeyEpoch: number, delegationRevision: number): void {
	if (!a.delegation.purposes.includes(PURPOSE[type])) fail('purpose');
	if (accountId !== a.delegation.accountId || productKeyEpoch !== a.delegation.productKeyEpoch || delegationRevision !== a.delegation.delegationRevision) {
		fail('context', 'statement does not match the delegation');
	}
}

export async function verifyCalendarMessage(a: CalendarAuthority, raw: Uint8Array, signature: Uint8Array): Promise<CalendarMessage> {
	const m = parseCalendarMessage(raw);
	check(a, m.type, m.accountId, m.productKeyEpoch, m.delegationRevision);
	await verifyTranscript(CALENDAR_DOMAIN[m.type], raw, signature, a.signingKey);
	return m;
}

export async function verifyCalendarFreeBusy(a: CalendarAuthority, raw: Uint8Array, signature: Uint8Array): Promise<CalendarFreeBusy> {
	const f = parseCalendarFreeBusy(raw);
	check(a, CALENDAR_TYPE.freeBusy, f.accountId, f.productKeyEpoch, f.delegationRevision);
	await verifyTranscript(CALENDAR_DOMAIN[CALENDAR_TYPE.freeBusy], raw, signature, a.signingKey);
	return f;
}

export async function verifyCalendarGrant(a: CalendarAuthority, raw: Uint8Array, signature: Uint8Array): Promise<CalendarGrant> {
	const g = parseCalendarGrant(raw);
	check(a, CALENDAR_TYPE.grant, g.accountId, g.productKeyEpoch, g.delegationRevision);
	await verifyTranscript(CALENDAR_DOMAIN[CALENDAR_TYPE.grant], raw, signature, a.signingKey);
	return g;
}
