/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { generateCurve25519Key } from '$core/keys/pgpKeys';
import { currentProduct } from '../../products';
import { keyCreationDate } from '../opaque-params';
import type { CalendarStatementType } from '../productkeys/calendar';
import { CALENDAR_DOMAIN, CALENDAR_TYPE, encodeCalendarFreeBusy, encodeCalendarGrant, encodeCalendarMessage } from '../productkeys/calendar';
import { sha256 } from '../productkeys/encoding';
import { formatTime } from '../productkeys/fields';
import { fingerprintBytes, parsePublicKey, publicKeyDigest, signTranscript, validateProfile } from '../productkeys/pgp';
import { PROFILE } from '../productkeys/profiles';
import type {
	CalendarStatementResponse,
	CreateCalendarKeyArgs,
	CreateCalendarKeyResponse,
	CreatedCalendarGrant,
	LoadCalendarKeysArgs,
	LoadCalendarKeysResponse,
	SignCalendarGrantArgs,
	SignFreeBusyArgs,
	SignInvitationArgs,
	SignReplyArgs
} from '../protocol';
import type { VaultState } from './state';
import { broadcast, fingerprintHexOf, recomputeAliasCurrent, vaults } from './state';

type Calendar = { ok: true; v: VaultState } | { ok: false; code: 'locked' | 'not_calendar' };

function calendarVault(accountId: string): Calendar {
	const v = vaults.get(accountId);
	if (!v) return { ok: false, code: 'locked' };
	if (currentProduct !== 'calendar' || v.product !== 'calendar') return { ok: false, code: 'not_calendar' };
	return { ok: true, v };
}

async function signStatement(accountId: string, type: CalendarStatementType, build: () => Promise<Uint8Array>): Promise<CalendarStatementResponse> {
	const vault = calendarVault(accountId);
	if (!vault.ok) return vault;
	let raw: Uint8Array;
	try {
		raw = await build();
	} catch {
		return { ok: false, code: 'invalid' };
	}
	try {
		const signature = await signTranscript(CALENDAR_DOMAIN[type], raw, vault.v.privateKey);
		return { ok: true, statement: raw, signature, signerFingerprint: fingerprintBytes(vault.v.privateKey) };
	} catch (err) {
		console.warn('keystore: calendar signature failed', err);
		return { ok: false, code: 'unknown' };
	}
}

const now = () => formatTime(new Date());

export function handleSignInvitation(a: SignInvitationArgs): Promise<CalendarStatementResponse> {
	return signStatement(a.accountId, CALENDAR_TYPE.invitation, async () =>
		encodeCalendarMessage({
			type: CALENDAR_TYPE.invitation,
			accountId: a.accountId,
			organizerAccountId: a.accountId,
			calendarId: a.calendarId,
			eventId: a.eventId,
			uid: a.uid,
			method: a.method,
			sequence: a.sequence,
			recipients: [...new Set(a.recipients)].sort(),
			contentDigest: await sha256(a.content),
			productKeyEpoch: a.productKeyEpoch,
			delegationRevision: a.delegationRevision,
			membershipRevision: a.membershipRevision,
			operationId: a.operationId,
			issuedAt: now()
		})
	);
}

export function handleSignReply(a: SignReplyArgs): Promise<CalendarStatementResponse> {
	return signStatement(a.accountId, CALENDAR_TYPE.reply, async () =>
		encodeCalendarMessage({
			type: CALENDAR_TYPE.reply,
			accountId: a.accountId,
			organizerAccountId: a.organizerAccountId,
			calendarId: a.calendarId,
			eventId: a.eventId,
			uid: a.uid,
			method: 'REPLY',
			sequence: a.sequence,
			recipients: [a.organizerAccountId],
			contentDigest: await sha256(a.content),
			productKeyEpoch: a.productKeyEpoch,
			delegationRevision: a.delegationRevision,
			membershipRevision: 0,
			operationId: a.operationId,
			issuedAt: now()
		})
	);
}

export function handleSignFreeBusy(a: SignFreeBusyArgs): Promise<CalendarStatementResponse> {
	return signStatement(a.accountId, CALENDAR_TYPE.freeBusy, async () =>
		encodeCalendarFreeBusy({
			accountId: a.accountId,
			calendarId: a.calendarId,
			itemId: a.itemId,
			privacy: a.privacy,
			revision: a.revision,
			rangeStart: a.rangeStart,
			rangeEnd: a.rangeEnd,
			windows: a.windows,
			productKeyEpoch: a.productKeyEpoch,
			delegationRevision: a.delegationRevision,
			issuedAt: now()
		})
	);
}

async function recipientIdentity(raw: Uint8Array): Promise<openpgp.PublicKey> {
	const key = await parsePublicKey(raw);
	await validateProfile(PROFILE.calendarIdentity, key);
	return key;
}

export function handleSignCalendarGrant(a: SignCalendarGrantArgs): Promise<CalendarStatementResponse> {
	return signStatement(a.accountId, CALENDAR_TYPE.grant, async () => {
		const recipient = await recipientIdentity(a.recipientPublicKey);
		return encodeCalendarGrant({
			accountId: a.accountId,
			calendarId: a.calendarId,
			keyVersion: a.keyVersion,
			keyFingerprint: a.keyFingerprint,
			memberAccountId: a.memberAccountId,
			role: a.role,
			recipientPublicKeyDigest: await publicKeyDigest(recipient),
			wrappedKeyDigest: await sha256(a.wrappedKey),
			productKeyEpoch: a.productKeyEpoch,
			delegationRevision: a.delegationRevision,
			issuedAt: now()
		});
	});
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function handleCreateCalendarKey(a: CreateCalendarKeyArgs): Promise<CreateCalendarKeyResponse> {
	const vault = calendarVault(a.accountId);
	if (!vault.ok) return vault;
	let members: { accountId: string; role: CreatedCalendarGrant['role']; key: openpgp.PublicKey; raw: Uint8Array }[];
	try {
		members = await Promise.all(a.members.map(async (m) => ({ ...m, key: await recipientIdentity(m.recipientPublicKey), raw: m.recipientPublicKey })));
	} catch {
		return { ok: false, code: 'invalid_recipient_key' };
	}
	if (members.length === 0) return { ok: false, code: 'invalid_recipient_key' };
	try {
		const generated = await generateCurve25519Key({
			userIDs: [{ name: 'Thelemail calendar', email: '' }],
			date: keyCreationDate(Date.now() + (a.serverClockOffsetMs ?? 0))
		});
		const armoredPrivate = generated.privateKey.armor();
		const keyFingerprint = fingerprintBytes(generated.privateKey);
		const grants: CreatedCalendarGrant[] = [];
		for (const m of members) {
			const wrapped = await openpgp.encrypt({
				message: await openpgp.createMessage({ text: armoredPrivate }),
				encryptionKeys: m.key,
				signingKeys: vault.v.privateKey,
				format: 'armored'
			});
			const wrappedPrivateKey = encoder.encode(wrapped as string);
			const signed = await handleSignCalendarGrant({
				accountId: a.accountId,
				calendarId: a.calendarId,
				keyVersion: a.keyVersion,
				keyFingerprint,
				memberAccountId: m.accountId,
				role: m.role,
				recipientPublicKey: m.raw,
				wrappedKey: wrappedPrivateKey,
				productKeyEpoch: a.productKeyEpoch,
				delegationRevision: a.delegationRevision
			});
			if (!signed.ok) return { ok: false, code: signed.code === 'locked' || signed.code === 'not_calendar' ? signed.code : 'unknown' };
			grants.push({
				accountId: m.accountId,
				role: m.role,
				memberKeyFingerprint: fingerprintBytes(m.key),
				wrappedPrivateKey,
				grantStatement: signed.statement,
				grantSignature: signed.signature
			});
		}
		return { ok: true, publicKeyArmored: generated.publicKey.armor(), keyFingerprint, grants };
	} catch (err) {
		console.warn('keystore: calendar key generation failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export async function handleLoadCalendarKeys(a: LoadCalendarKeysArgs): Promise<LoadCalendarKeysResponse> {
	const vault = calendarVault(a.accountId);
	if (!vault.ok) return vault;
	const v = vault.v;
	const loaded: string[] = [];
	const failed: { calendarId: string; keyVersion: number }[] = [];
	for (const g of a.grants) {
		const want = g.calendarKeyFingerprintHex.toLowerCase();
		if (v.aliasKeys.has(want)) {
			loaded.push(want);
			continue;
		}
		try {
			const message = await openpgp.readMessage({ armoredMessage: decoder.decode(g.wrappedPrivateKey) });
			const { data } = await openpgp.decrypt({ message, decryptionKeys: v.privateKey, expectSigned: false });
			if (typeof data !== 'string') throw new Error('calendar key grant is not text');
			const privateKey = await openpgp.readPrivateKey({ armoredKey: data });
			const got = fingerprintHexOf(privateKey);
			if (got !== want) throw new Error('calendar key grant names another key');
			v.aliasKeys.set(got, { aliasId: g.calendarId, addressId: g.calendarId, email: '', keyVersion: g.keyVersion, fingerprintHex: got, privateKey });
			loaded.push(got);
		} catch (err) {
			console.warn('keystore: calendar key unwrap failed', err);
			failed.push({ calendarId: g.calendarId, keyVersion: g.keyVersion });
		}
	}
	recomputeAliasCurrent(v);
	broadcast({ type: 'aliasKeysChanged', accountId: a.accountId, fingerprints: [...v.aliasKeys.keys()] });
	return { ok: true, loaded, failed };
}
