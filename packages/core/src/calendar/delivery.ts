import * as openpgp from 'openpgp';
import type { CalendarDeliveryRecipient, CalendarInvitationEnvelope } from '$core/api/calendars';
import {
	acknowledgeCalendarInvitation,
	deliverCalendarMessage,
	listCalendarInvitations,
	listPendingCalendarDeliveries
} from '$core/api/calendars';
import { submitCalendarExternal } from '$core/api/submission';
import { keystore } from '$core/keystore/keystore-client';
import type { CalendarMessage } from '$core/keystore/productkeys/calendar';
import { CALENDAR_TYPE, parseCalendarMessage, verifyCalendarMessage } from '$core/keystore/productkeys/calendar';
import { ProductKeysError } from '$core/keystore/productkeys/errors';
import { b64decode, b64encode, sha256 } from '$core/keystore/productkeys/encoding';
import { parseIcs } from '$core/mail/render/icalParse';
import { m } from '$paraglide/messages.js';
import type { CalendarDb, DeliveryRecord, EventMark } from './db';
import type { CalendarIdentity, CalendarRecipient } from './identity';
import { CalendarIdentityError, resolveCalendarRecipient } from './identity';
import { parseInvitation } from './ics/fromMail';
import type { OutboxMail } from './outbox';
import type { CalendarSigningContext } from './signing';

export const PAYLOAD_TYPE = 'thelemail-calendar-payload/v1';
const PAYLOAD_FIELDS = ['body', 'ics', 'method', 'subject', 'type'] as const;
const MAX_OPERATIONS = 32;

export interface CalendarPayload {
	method: OutboxMail['method'];
	subject: string;
	body: string;
	ics: string;
}

export class CalendarDeliveryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CalendarDeliveryError';
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodePayload(p: CalendarPayload): Uint8Array {
	return encoder.encode(JSON.stringify({ body: p.body, ics: p.ics, method: p.method, subject: p.subject, type: PAYLOAD_TYPE }));
}

export function parsePayload(raw: Uint8Array): CalendarPayload {
	const text = decoder.decode(raw);
	const o = JSON.parse(text) as Record<string, unknown>;
	if (Object.keys(o).length !== PAYLOAD_FIELDS.length || o.type !== PAYLOAD_TYPE) throw new CalendarDeliveryError('payload fields');
	for (const f of PAYLOAD_FIELDS) if (typeof o[f] !== 'string') throw new CalendarDeliveryError(`payload ${f}`);
	if (!['REQUEST', 'CANCEL', 'REPLY'].includes(o.method as string)) throw new CalendarDeliveryError('payload method');
	return { method: o.method as CalendarPayload['method'], subject: o.subject as string, body: o.body as string, ics: o.ics as string };
}

export function eventKey(organizerAccountId: string, uid: string, signerAccountId: string): string {
	return `${organizerAccountId} ${uid} ${signerAccountId}`;
}

export function originKey(uid: string): string {
	return `origin ${uid}`;
}

async function sealFor(accountId: string, identity: CalendarIdentity, payload: Uint8Array): Promise<CalendarDeliveryRecipient> {
	const key = await openpgp.readKey({ binaryKey: identity.signingKey });
	const res = await keystore.encryptToKeys({
		accountId,
		recipientPublicKeysArmored: [key.armor()],
		plaintext: payload,
		signWithVaultKey: false
	});
	if (!res.ok) throw new CalendarDeliveryError(res.code === 'locked' ? m.cal_caldlg_unlock() : res.code);
	return {
		accountId: identity.accountId,
		recipientKeyDigest: b64encode(identity.authority.signingKeyDigest),
		ciphertext: b64encode(encoder.encode(res.armored))
	};
}

async function signFor(
	accountId: string,
	ctx: CalendarSigningContext,
	db: CalendarDb,
	mail: OutboxMail,
	itemId: string,
	operationId: string,
	internal: CalendarRecipient[],
	payload: Uint8Array
): Promise<DeliveryRecord> {
	const event = mail.event;
	if (!event) throw new CalendarDeliveryError('the invitation has no event context');
	const recipients = internal.map((r) => (r.kind === 'published' ? r.identity.accountId : r.kind === 'pending' ? r.accountId : ''));
	const delegation = { productKeyEpoch: ctx.productKeyEpoch, delegationRevision: ctx.delegationRevision };
	let res;
	if (mail.method === 'REPLY') {
		const origin = (await db.eventMark(accountId, originKey(event.uid)))?.origin;
		if (!origin || recipients.length !== 1 || recipients[0] !== origin.organizerAccountId) {
			throw new CalendarDeliveryError(m.cal_delivery_reply_from_mail());
		}
		res = await keystore.signReply({
			accountId,
			...delegation,
			organizerAccountId: origin.organizerAccountId,
			calendarId: origin.calendarId,
			eventId: origin.eventId,
			uid: event.uid,
			sequence: event.sequence,
			content: payload,
			operationId
		});
	} else {
		res = await keystore.signInvitation({
			accountId,
			...delegation,
			calendarId: event.calendarId,
			eventId: itemId,
			uid: event.uid,
			method: mail.method,
			sequence: event.sequence,
			recipients,
			content: payload,
			membershipRevision: event.membershipRevision,
			operationId
		});
	}
	if (!res.ok) throw new CalendarDeliveryError(res.code === 'locked' ? m.cal_caldlg_unlock() : m.cal_delivery_sign_failed());
	const record: DeliveryRecord = {
		accountId,
		operationId,
		statement: b64encode(res.statement),
		signature: b64encode(res.signature),
		payload: decoder.decode(payload)
	};
	await db.putDelivery(record);
	return record;
}

function externalSender(mail: OutboxMail): string {
	if (mail.method !== 'REPLY') return mail.fromEmail ?? '';
	return parseInvitation(mail.ics, [])?.attendees[0]?.email ?? '';
}

export async function deliverCalendarMail(
	accountId: string,
	ctx: CalendarSigningContext,
	db: CalendarDb,
	itemId: string,
	mail: OutboxMail
): Promise<void> {
	const operationId = mail.operationId ?? crypto.randomUUID();
	const addresses = [...new Set(mail.to.map((r) => r.address.trim().toLowerCase()))];
	const resolved = await Promise.all(addresses.map((a) => resolveCalendarRecipient(db, accountId, a)));
	const internal = resolved.filter((r) => r.kind !== 'external');
	const external = resolved.filter((r) => r.kind === 'external').map((r) => r.email);
	const payload = encodePayload({ method: mail.method, subject: mail.subject, body: mail.body, ics: mail.ics });

	if (internal.length) {
		const record = (await db.delivery(accountId, operationId)) ?? (await signFor(accountId, ctx, db, mail, itemId, operationId, internal, payload));
		const sealed = encoder.encode(record.payload);
		const recipients = await Promise.all(
			internal.map((r) =>
				r.kind === 'published' ? sealFor(accountId, r.identity, sealed) : Promise.resolve({ accountId: r.kind === 'pending' ? r.accountId : '' })
			)
		);
		const res = await deliverCalendarMessage({ statement: record.statement, signature: record.signature, recipients });
		if (res.pending.length === 0) await db.removeDelivery(accountId, operationId);
	}

	if (external.length) {
		const fromAddress = externalSender(mail);
		if (!fromAddress) throw new CalendarDeliveryError(m.cal_delivery_no_sender());
		await submitCalendarExternal({
			idempotencyKey: operationId,
			fromAddress,
			recipients: external,
			subject: mail.subject,
			text: mail.body,
			method: mail.method,
			ics: mail.ics
		});
	}
}

export async function releasePendingDeliveries(accountId: string, db: CalendarDb): Promise<void> {
	const { invitations } = await listPendingCalendarDeliveries();
	const byOperation = new Map<string, CalendarInvitationEnvelope[]>();
	for (const env of invitations) byOperation.set(env.operationId, [...(byOperation.get(env.operationId) ?? []), env]);
	for (const [operationId, pending] of byOperation) {
		const record = await db.delivery(accountId, operationId);
		if (!record) continue;
		const statement = parseCalendarMessage(b64decode(record.statement));
		const waiting = new Set(pending.map((p) => p.recipientAccountId));
		const emails = new Map(pending.map((p) => [p.recipientAccountId, p.recipientEmail ?? '']));
		let released = 0;
		const recipients: CalendarDeliveryRecipient[] = [];
		for (const id of statement.recipients) {
			const email = emails.get(id);
			if (!waiting.has(id) || !email) {
				recipients.push({ accountId: id });
				continue;
			}
			const r = await resolveCalendarRecipient(db, accountId, email).catch(() => null);
			if (r?.kind === 'published' && r.identity.accountId === id) {
				recipients.push(await sealFor(accountId, r.identity, encoder.encode(record.payload)));
				released++;
			} else {
				recipients.push({ accountId: id });
			}
		}
		if (!released) continue;
		const res = await deliverCalendarMessage({ statement: record.statement, signature: record.signature, recipients });
		if (res.pending.length === 0) await db.removeDelivery(accountId, operationId);
	}
}

export interface VerifiedDelivery {
	envelope: CalendarInvitationEnvelope;
	message: CalendarMessage;
	payload: CalendarPayload;
	sender: CalendarIdentity;
}

export async function openDelivery(accountId: string, db: CalendarDb, env: CalendarInvitationEnvelope): Promise<VerifiedDelivery> {
	const sender = await resolveCalendarRecipient(db, accountId, env.senderEmail);
	if (sender.kind !== 'published' || sender.identity.accountId !== env.senderAccountId) {
		throw new CalendarDeliveryError('the sender has no verified calendar identity');
	}
	const message = await verifyCalendarMessage(sender.identity.authority, b64decode(env.statement), b64decode(env.signature));
	if (message.accountId !== env.senderAccountId || !message.recipients.includes(accountId) || !env.ciphertext) {
		throw new CalendarDeliveryError('the statement does not address this account');
	}
	const res = await keystore.decrypt({ accountId, ciphertextArmored: decoder.decode(b64decode(env.ciphertext)), binary: true });
	if (!res.ok || !('plaintextBinary' in res)) throw new CalendarDeliveryError('the invitation does not decrypt');
	const digest = await sha256(res.plaintextBinary);
	if (b64encode(digest) !== b64encode(message.contentDigest)) throw new CalendarDeliveryError('the invitation does not match its signature');
	const payload = parsePayload(res.plaintextBinary);
	if (payload.method !== message.method) throw new CalendarDeliveryError('the invitation method does not match its signature');
	const inv = parseInvitation(payload.ics, []);
	const senderEmail = env.senderEmail.toLowerCase();
	if (!inv || inv.uid !== message.uid) throw new CalendarDeliveryError('the invitation does not match its signature');
	if (message.method === 'REPLY') {
		if (inv.attendees.length !== 1 || inv.attendees[0].email.toLowerCase() !== senderEmail) {
			throw new CalendarDeliveryError('the reply is not from its sender');
		}
	} else if (inv.organizer?.email.toLowerCase() !== senderEmail) {
		throw new CalendarDeliveryError('the invitation is not from its organizer');
	}
	return { envelope: env, message, payload, sender: sender.identity };
}

export function isReplay(mark: EventMark | null, message: CalendarMessage): boolean {
	if (!mark) return false;
	return message.sequence < mark.sequence || mark.operations.includes(message.operationId);
}

export async function noteApplied(accountId: string, db: CalendarDb, d: VerifiedDelivery): Promise<void> {
	const msg = d.message;
	const key = eventKey(msg.organizerAccountId, msg.uid, msg.accountId);
	const mark = await db.eventMark(accountId, key);
	await db.putEventMark({
		accountId,
		event: key,
		sequence: Math.max(mark?.sequence ?? 0, msg.sequence),
		operations: [...(mark?.operations ?? []), msg.operationId].slice(-MAX_OPERATIONS)
	});
	if (msg.type === CALENDAR_TYPE.invitation) {
		await db.putEventMark({
			accountId,
			event: originKey(msg.uid),
			sequence: msg.sequence,
			operations: [],
			origin: { organizerAccountId: msg.organizerAccountId, calendarId: msg.calendarId, eventId: msg.eventId }
		});
	}
}

function refused(err: unknown): boolean {
	return err instanceof CalendarDeliveryError || err instanceof ProductKeysError || (err instanceof CalendarIdentityError && err.code === 'unverified') || err instanceof SyntaxError;
}

export type ApplyDelivery = (d: VerifiedDelivery, events: ReturnType<typeof parseIcs>) => Promise<void>;

export async function processInbox(accountId: string, db: CalendarDb, apply: ApplyDelivery): Promise<number> {
	const { invitations } = await listCalendarInvitations();
	let applied = 0;
	for (const env of invitations) {
		let d: VerifiedDelivery;
		try {
			d = await openDelivery(accountId, db, env);
		} catch (err) {
			if (!refused(err)) throw err;
			console.warn('calendar: dropped an invitation that did not verify', err);
			await acknowledgeCalendarInvitation(env.id);
			continue;
		}
		const mark = await db.eventMark(accountId, eventKey(d.message.organizerAccountId, d.message.uid, d.message.accountId));
		if (!isReplay(mark, d.message)) {
			await apply(d, parseIcs(d.payload.ics));
			await noteApplied(accountId, db, d);
			applied++;
		}
		await acknowledgeCalendarInvitation(env.id);
	}
	return applied;
}
