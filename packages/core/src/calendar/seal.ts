import type { CalendarMemberGrant, CalendarRow } from '$core/api/calendars';
import { keystore } from '$core/keystore/keystore-client';
import { b64ToBytes, bytesToB64 } from '$core/crypto';
import { b64ToHex, hexToB64, textToB64 } from '$core/keys/encode';
import { senderKey } from '$core/mail/send';
import { aliasKeys } from '$core/stores/aliasKeys.svelte';
import { calendarKeys } from '$core/stores/calendarKeys.svelte';

export interface SealKey {
	publicKeyArmored: string;
	fingerprintB64: string;
	fingerprintHex: string;
}

export class SealError extends Error {
	code: 'locked' | 'no_key' | 'invalid_ciphertext' | 'unknown';
	constructor(code: SealError['code'], message?: string) {
		super(message ?? code);
		this.code = code;
		this.name = 'SealError';
	}
}

export const CALENDAR_KEY_ALGORITHM = 'openpgp-curve25519-v6';

export interface MintedCalendarKey {
	key: SealKey;
	grants: CalendarMemberGrant[];
}

export async function mintOwnCalendarKey(accountId: string): Promise<MintedCalendarKey> {
	const own = await senderKey(accountId);
	const created = await keystore.createAliasKey({
		accountId,
		email: '',
		displayName: 'Thelemail calendar',
		recipients: [{ accountId, publicKeyArmored: own.publicKeyArmored }]
	});
	if (!created.ok) {
		throw new SealError(created.code === 'locked' ? 'locked' : 'unknown', 'Could not create the calendar key');
	}
	return {
		key: {
			publicKeyArmored: created.publicKeyArmored,
			fingerprintB64: hexToB64(created.keyFingerprintHex),
			fingerprintHex: created.keyFingerprintHex
		},
		grants: created.grants.map((g) => ({
			accountId: g.accountId,
			role: 'owner' as const,
			memberKeyFingerprint: hexToB64(g.memberKeyFingerprintHex),
			wrappedPrivateKey: textToB64(g.wrappedPrivateKeyArmored)
		}))
	};
}

export async function keyForCalendar(accountId: string, cal: CalendarRow): Promise<SealKey> {
	switch (cal.kind) {
		case 'personal':
		case 'shared': {
			await calendarKeys.ready(accountId);
			let key = calendarKeys.publicKeyFor(cal.id);
			if (!key || (cal.keyFingerprint && key.fingerprintB64 !== cal.keyFingerprint)) {
				await calendarKeys.load(accountId);
				key = calendarKeys.publicKeyFor(cal.id);
			}
			if (!key) throw new SealError('no_key', 'You do not hold the key for this calendar yet.');
			return {
				publicKeyArmored: key.publicKeyArmored,
				fingerprintB64: key.fingerprintB64,
				fingerprintHex: key.fingerprintHex
			};
		}
		case 'role': {
			if (!cal.sharedAliasId) throw new SealError('no_key', 'This role calendar has no address.');
			await aliasKeys.ready(accountId);
			const res = await keystore.getPublicKey({ accountId, aliasId: cal.sharedAliasId });
			if (!res.ok) {
				await aliasKeys.load(accountId);
				const retry = await keystore.getPublicKey({ accountId, aliasId: cal.sharedAliasId });
				if (!retry.ok) throw new SealError('no_key', 'The shared address key is not loaded.');
				return fromPublicKey(retry.publicKeyArmored, retry.fingerprint);
			}
			return fromPublicKey(res.publicKeyArmored, res.fingerprint);
		}
	}
}

function fromPublicKey(publicKeyArmored: string, fingerprint: Uint8Array): SealKey {
	const b64 = bytesToB64(fingerprint);
	return { publicKeyArmored, fingerprintB64: b64, fingerprintHex: b64ToHex(b64) };
}

export async function sealText(
	accountId: string,
	key: SealKey,
	plaintext: string
): Promise<string> {
	const res = await keystore.encrypt({
		accountId,
		recipientPublicKeyArmored: key.publicKeyArmored,
		plaintext: new TextEncoder().encode(plaintext)
	});
	if (!res.ok) throw new SealError(res.code === 'locked' ? 'locked' : 'unknown', res.code);
	return bytesToB64(res.ciphertext);
}

async function decryptOnce(
	accountId: string,
	sealedB64: string,
	fingerprintHex?: string
): Promise<string> {
	const res = await keystore.decrypt({
		accountId,
		ciphertextBinary: b64ToBytes(sealedB64),
		keyFingerprintHex: fingerprintHex
	});
	if (!res.ok) {
		throw new SealError(
			res.code === 'locked'
				? 'locked'
				: res.code === 'no_matching_key'
					? 'no_key'
					: 'invalid_ciphertext',
			res.code
		);
	}
	if (!('plaintext' in res)) throw new SealError('invalid_ciphertext', 'expected text');
	return res.plaintext;
}

export async function openText(
	accountId: string,
	sealedB64: string,
	fingerprintB64?: string
): Promise<string> {
	const hint = fingerprintB64 ? b64ToHex(fingerprintB64) : undefined;
	await Promise.all([aliasKeys.ready(accountId), calendarKeys.ready(accountId)]);
	try {
		return await decryptOnce(accountId, sealedB64, hint);
	} catch (err) {
		if (!(err instanceof SealError) || err.code !== 'no_key') throw err;
		await Promise.all([aliasKeys.refresh(accountId), calendarKeys.load(accountId)]);
		return decryptOnce(accountId, sealedB64, hint);
	}
}
