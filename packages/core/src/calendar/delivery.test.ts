// @vitest-environment node
import type * as openpgp from 'openpgp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	resolve: vi.fn(),
	signInvitation: vi.fn(),
	encryptToKeys: vi.fn(),
	decrypt: vi.fn(),
	deliver: vi.fn(),
	list: vi.fn(),
	pending: vi.fn(),
	ack: vi.fn(),
	external: vi.fn()
}));

vi.mock('./identity', async (importOriginal) => ({ ...(await importOriginal<typeof import('./identity')>()), resolveCalendarRecipient: h.resolve }));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: { signInvitation: h.signInvitation, encryptToKeys: h.encryptToKeys, decrypt: h.decrypt }
}));
vi.mock('$core/api/calendars', () => ({
	deliverCalendarMessage: h.deliver,
	listCalendarInvitations: h.list,
	listPendingCalendarDeliveries: h.pending,
	acknowledgeCalendarInvitation: h.ack
}));
vi.mock('$core/api/submission', () => ({ submitCalendarExternal: h.external }));
vi.mock('$core/directory/signing-key', () => ({ DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: '', DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: '' }));

import { readFileSync } from 'node:fs';
import type { CalendarAuthority } from '$core/keystore/productkeys/calendar';
import { calendarAuthority, CALENDAR_DOMAIN, CALENDAR_TYPE, encodeCalendarMessage } from '$core/keystore/productkeys/calendar';
import { b64decode, b64encode, keyId, sha256 } from '$core/keystore/productkeys/encoding';
import { formatTime } from '$core/keystore/productkeys/fields';
import { DOMAIN, encodeDelegation, productPurposes } from '$core/keystore/productkeys/manifests';
import { fingerprintBytes, generateAuthorityKey, generateCalendarIdentity, publicKeyBytes, publicKeyDigest, signTranscript } from '$core/keystore/productkeys/pgp';
import { PROFILE } from '$core/keystore/productkeys/profiles';
import { memoryCalendarDb } from './db';
import { deliverCalendarMail, encodePayload, processInbox, releasePendingDeliveries } from './delivery';
import type { CalendarIdentity } from './identity';
import type { OutboxMail } from './outbox';

const me = '9c1e2a3b-4d5f-4a6b-8c7d-0e1f2a3b4c5d';
const bruno = '5b6f1c34-7d0e-4c3a-9f61-2a1d3b6c8e90';
const carla = '0a3d1f5e-2b7c-4e9a-8d61-7f2c4b9e1a03';
const calendarId = '7a2c9e10-3b5d-4f6a-8c1e-0d9b2a4f6e83';
const itemId = '0f1b7c2e-5a44-4c1e-9d0b-2f7e8a6c4d11';
const ics = readFileSync(new URL('./testdata/external-request.ics', import.meta.url), 'utf8');
const uid = '0f1b7c2e-5a44-4c1e-9d0b-2f7e8a6c4d11@thelemail.test';

async function identityFor(accountId: string, email: string): Promise<{ identity: CalendarIdentity; cal: openpgp.PrivateKey }> {
	const aak = await generateAuthorityKey();
	const cal = await generateCalendarIdentity();
	const digest = await publicKeyDigest(cal.toPublic());
	const id = keyId(accountId, fingerprintBytes(cal));
	const record = encodeDelegation({
		accountId, authorityKeyId: keyId(accountId, fingerprintBytes(aak)), authorityEpoch: 1, product: 'calendar', productKeyEpoch: 1,
		signingKeyId: id, signingProfileId: PROFILE.calendarIdentity, signingPublicKeyDigest: digest, recipientKeyId: id,
		recipientProfileId: PROFILE.calendarIdentity, recipientPublicKeyDigest: digest, purposes: productPurposes('calendar'),
		issuedAt: formatTime(new Date()), delegationRevision: 1, previousDelegationHash: null
	});
	const authority: CalendarAuthority = await calendarAuthority(accountId, publicKeyBytes(aak), 1, record, await signTranscript(DOMAIN.delegation, record, aak), publicKeyBytes(cal));
	return { identity: { accountId, email, authority, signingKey: publicKeyBytes(cal) }, cal };
}

let brunoId: CalendarIdentity;
let ada: { identity: CalendarIdentity; cal: openpgp.PrivateKey };

const mail = (): OutboxMail => ({
	to: [{ address: 'Bruno@thelemail.test' }, { address: 'carla@thelemail.test' }, { address: 'panurge@quart-livre.example' }],
	subject: 'Invitation: Quarterly review',
	body: 'Ada Calloway invited you to "Quarterly review".',
	ics,
	method: 'REQUEST',
	fromEmail: 'ada@thelemail.test',
	operationId: 'c3c0b1a2-4d5e-4f60-8a7b-9c0d1e2f3a4b',
	event: { calendarId, uid, sequence: 1, membershipRevision: 2 }
});

const ctx = { productKeyEpoch: 1, delegationRevision: 1, signingKey: new Uint8Array() };

beforeAll(async () => {
	brunoId = (await identityFor(bruno, 'bruno@thelemail.test')).identity;
	ada = await identityFor(me, 'ada@thelemail.test');
});

beforeEach(() => {
	for (const fn of Object.values(h)) fn.mockReset();
	h.resolve.mockImplementation(async (_db: unknown, _me: string, email: string) => {
		if (email === 'bruno@thelemail.test') return { kind: 'published', identity: brunoId };
		if (email === 'carla@thelemail.test') return { kind: 'pending', accountId: carla, email };
		if (email === 'ada@thelemail.test') return { kind: 'published', identity: ada.identity };
		return { kind: 'external', email };
	});
	h.signInvitation.mockResolvedValue({ ok: true, statement: new Uint8Array([1]), signature: new Uint8Array([2]), signerFingerprint: new Uint8Array() });
	h.encryptToKeys.mockResolvedValue({ ok: true, armored: '-----BEGIN PGP MESSAGE-----' });
	h.deliver.mockResolvedValue({ operationId: '', delivered: [bruno], pending: [carla] });
	h.external.mockResolvedValue({ messageId: 'x', enqueuedAt: '' });
	h.ack.mockResolvedValue(undefined);
});

describe('deliverCalendarMail', () => {
	it('signs once for Thelemail recipients, seals per identity and sends the exact ICS to outside recipients', async () => {
		const db = memoryCalendarDb();
		await deliverCalendarMail(me, ctx, db, itemId, mail());
		expect(h.signInvitation).toHaveBeenCalledWith(expect.objectContaining({
			accountId: me, calendarId, eventId: itemId, uid, method: 'REQUEST', sequence: 1, membershipRevision: 2,
			recipients: [bruno, carla], operationId: mail().operationId, content: encodePayload({ method: 'REQUEST', subject: mail().subject, body: mail().body, ics })
		}));
		const body = h.deliver.mock.calls[0][0];
		expect(body.recipients).toEqual([
			{ accountId: bruno, recipientKeyDigest: b64encode(brunoId.authority.signingKeyDigest), ciphertext: expect.any(String) },
			{ accountId: carla }
		]);
		expect(h.encryptToKeys).toHaveBeenCalledWith(expect.objectContaining({ signWithVaultKey: false }));
		expect(h.external).toHaveBeenCalledWith({
			idempotencyKey: mail().operationId, fromAddress: 'ada@thelemail.test', recipients: ['panurge@quart-livre.example'],
			subject: mail().subject, text: mail().body, method: 'REQUEST', ics
		});
		expect(await db.delivery(me, mail().operationId as string)).not.toBeNull();
	});

	it('reuses the signed statement when the outbox retries', async () => {
		const db = memoryCalendarDb();
		await deliverCalendarMail(me, ctx, db, itemId, mail());
		await deliverCalendarMail(me, ctx, db, itemId, mail());
		expect(h.signInvitation).toHaveBeenCalledTimes(1);
		expect(h.deliver.mock.calls[1][0].statement).toBe(h.deliver.mock.calls[0][0].statement);
	});
});

describe('releasePendingDeliveries', () => {
	const operationId = mail().operationId as string;
	const waiting = { operationId, recipientAccountId: carla, recipientEmail: 'carla@thelemail.test' };

	async function sent() {
		const statement = encodeCalendarMessage({
			type: CALENDAR_TYPE.invitation, accountId: me, organizerAccountId: me, calendarId, eventId: itemId, uid, method: 'REQUEST', sequence: 1,
			recipients: [carla, bruno], contentDigest: await sha256(encodePayload({ method: 'REQUEST', subject: 's', body: 'b', ics })),
			productKeyEpoch: 1, delegationRevision: 1, membershipRevision: 2, operationId, issuedAt: formatTime(new Date())
		});
		h.signInvitation.mockResolvedValue({ ok: true, statement, signature: new Uint8Array([2]), signerFingerprint: new Uint8Array() });
		const db = memoryCalendarDb();
		await deliverCalendarMail(me, ctx, db, itemId, mail());
		h.deliver.mockClear();
		h.pending.mockResolvedValue({ invitations: [waiting] });
		return db;
	}

	it('seals the stored invitation to a recipient whose identity has appeared and resends the same statement', async () => {
		const db = await sent();
		const record = await db.delivery(me, operationId);
		const carlaId = (await identityFor(carla, 'carla@thelemail.test')).identity;
		h.resolve.mockImplementation(async (_db: unknown, _me: string, email: string) =>
			email === 'carla@thelemail.test' ? { kind: 'published', identity: carlaId } : { kind: 'external', email }
		);
		h.deliver.mockResolvedValue({ operationId, delivered: [bruno, carla], pending: [] });
		await releasePendingDeliveries(me, db);
		expect(h.signInvitation).toHaveBeenCalledTimes(1);
		const body = h.deliver.mock.calls[0][0];
		expect(body.statement).toBe(record?.statement);
		expect(body.signature).toBe(record?.signature);
		expect(body.recipients).toEqual([
			{ accountId: carla, recipientKeyDigest: b64encode(carlaId.authority.signingKeyDigest), ciphertext: expect.any(String) },
			{ accountId: bruno }
		]);
		expect(await db.delivery(me, operationId)).toBeNull();
	});

	it('sends nothing while the recipient still has no identity', async () => {
		const db = await sent();
		await releasePendingDeliveries(me, db);
		expect(h.deliver).not.toHaveBeenCalled();
		expect(await db.delivery(me, operationId)).not.toBeNull();
	});

	it('refuses an identity that belongs to another account', async () => {
		const db = await sent();
		h.resolve.mockResolvedValue({ kind: 'published', identity: brunoId });
		await releasePendingDeliveries(me, db);
		expect(h.deliver).not.toHaveBeenCalled();
	});

	it('skips an operation this device did not send', async () => {
		h.pending.mockResolvedValue({ invitations: [waiting] });
		await releasePendingDeliveries(me, memoryCalendarDb());
		expect(h.resolve).not.toHaveBeenCalled();
		expect(h.deliver).not.toHaveBeenCalled();
	});
});

async function envelope(edit: { recipients?: string[]; payload?: Uint8Array; sequence?: number; organizerEmail?: string; operationId?: string } = {}) {
	const payload = edit.payload ?? encodePayload({ method: 'REQUEST', subject: 's', body: 'b', ics });
	const statement = encodeCalendarMessage({
		type: CALENDAR_TYPE.invitation, accountId: bruno, organizerAccountId: bruno, calendarId, eventId: itemId, uid,
		method: 'REQUEST', sequence: edit.sequence ?? 1, recipients: edit.recipients ?? [me], contentDigest: await sha256(encodePayload({ method: 'REQUEST', subject: 's', body: 'b', ics })),
		productKeyEpoch: 1, delegationRevision: 1, membershipRevision: 0, operationId: edit.operationId ?? 'd4d0b1a2-4d5e-4f60-8a7b-9c0d1e2f3a4b', issuedAt: formatTime(new Date())
	});
	h.decrypt.mockResolvedValue({ ok: true, plaintextBinary: payload });
	return {
		id: crypto.randomUUID(), operationId: 'd4d0b1a2-4d5e-4f60-8a7b-9c0d1e2f3a4b', kind: 'invitation' as const,
		senderAccountId: bruno, senderEmail: edit.organizerEmail ?? 'bruno@thelemail.test', recipientAccountId: me,
		statement: b64encode(statement), signature: b64encode(await signTranscript(CALENDAR_DOMAIN[CALENDAR_TYPE.invitation], statement, brunoCal)),
		ciphertext: b64encode(new TextEncoder().encode('armored')), createdAt: ''
	};
}

let brunoCal: openpgp.PrivateKey;

describe('processInbox', () => {
	beforeAll(async () => {
		const b = await identityFor(bruno, 'bruno@thelemail.test');
		brunoId = b.identity;
		brunoCal = b.cal;
	});

	it('refuses an invitation whose ICS names another organizer and acknowledges it without applying', async () => {
		const apply = vi.fn();
		h.list.mockResolvedValue({ invitations: [await envelope()] });
		expect(await processInbox(me, memoryCalendarDb(), apply)).toBe(0);
		expect(apply).not.toHaveBeenCalled();
		expect(h.ack).toHaveBeenCalledTimes(1);
	});

	it('refuses content that does not match the signed digest', async () => {
		const apply = vi.fn();
		const tampered = encodePayload({ method: 'REQUEST', subject: 's', body: 'changed', ics });
		h.list.mockResolvedValue({ invitations: [await envelope({ payload: tampered })] });
		expect(await processInbox(me, memoryCalendarDb(), apply)).toBe(0);
		expect(apply).not.toHaveBeenCalled();
	});

	it('refuses a statement that does not address this account', async () => {
		const apply = vi.fn();
		h.list.mockResolvedValue({ invitations: [await envelope({ recipients: [carla] })] });
		expect(await processInbox(me, memoryCalendarDb(), apply)).toBe(0);
		expect(apply).not.toHaveBeenCalled();
	});

	it('leaves an invitation unacknowledged when the vault is locked or the network fails', async () => {
		const env = await envelope();
		h.list.mockResolvedValue({ invitations: [env] });
		h.resolve.mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(processInbox(me, memoryCalendarDb(), vi.fn())).rejects.toThrow('Failed to fetch');
		expect(h.ack).not.toHaveBeenCalled();
	});

	it('applies a verified invitation once and skips a replayed or older one', async () => {
		const organizerIcs = ics.replace('ORGANIZER;CN=Ada Calloway:mailto:ada@thelemail.test', 'ORGANIZER;CN=Bruno:mailto:bruno@thelemail.test');
		const payload = encodePayload({ method: 'REQUEST', subject: 's', body: 'b', ics: organizerIcs });
		const db = memoryCalendarDb();
		const apply = vi.fn();
		const signed = async (sequence: number, operationId: string) => {
			const statement = encodeCalendarMessage({
				type: CALENDAR_TYPE.invitation, accountId: bruno, organizerAccountId: bruno, calendarId, eventId: itemId, uid,
				method: 'REQUEST', sequence, recipients: [me], contentDigest: await sha256(payload),
				productKeyEpoch: 1, delegationRevision: 1, membershipRevision: 0, operationId, issuedAt: formatTime(new Date())
			});
			return {
				id: crypto.randomUUID(), operationId, kind: 'invitation' as const, senderAccountId: bruno, senderEmail: 'bruno@thelemail.test',
				recipientAccountId: me, statement: b64encode(statement),
				signature: b64encode(await signTranscript(CALENDAR_DOMAIN[CALENDAR_TYPE.invitation], statement, brunoCal)),
				ciphertext: b64encode(new TextEncoder().encode('armored')), createdAt: ''
			};
		};
		h.decrypt.mockResolvedValue({ ok: true, plaintextBinary: payload });
		const first = await signed(2, 'e1d0b1a2-4d5e-4f60-8a7b-9c0d1e2f3a4b');
		const older = await signed(1, 'e2d0b1a2-4d5e-4f60-8a7b-9c0d1e2f3a4b');
		h.list.mockResolvedValue({ invitations: [first, first, older] });
		expect(await processInbox(me, db, apply)).toBe(1);
		expect(apply).toHaveBeenCalledTimes(1);
		expect(h.ack).toHaveBeenCalledTimes(3);
		const origin = await db.eventMark(me, `origin ${uid}`);
		expect(origin?.origin).toEqual({ organizerAccountId: bruno, calendarId, eventId: itemId });
		expect(b64decode(first.statement).length).toBeGreaterThan(0);
	});
});
