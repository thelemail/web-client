import * as openpgp from 'openpgp';
import { b64ToBytes } from '$core/crypto';
import { b64ToHex } from '$core/keys/encode';
import { canonicalise, type BusyStatement } from './busycanon';
import { signedWhileCurrent } from '$core/directory/retired';
import type { CalendarAuthority } from '$core/keystore/productkeys/calendar';
import { verifyCalendarFreeBusy } from '$core/keystore/productkeys/calendar';

export type BusyTrust =
	| 'verified'
	| 'signature_failed'
	| 'key_mismatch'
	| 'key_unresolved'
	| 'signer_unknown'
	| 'unsigned';

export interface BusyVerdict {
	trust: BusyTrust;
	signedAtMillis: number | null;
}

export interface BusyPreviousKey {
	fingerprintHex: string;
	publicKeyArmored: string;
	retiredAtMillis: number;
}

export interface VerifyBusyInput {
	statement: BusyStatement;
	signature: string;
	signerKeyFingerprint: string;
	publicKeyArmored: string;
	directoryKeyFingerprintHex: string;
	previousKey?: BusyPreviousKey | null;
	updatedAtMillis?: number;
	busyStatement?: string;
	calendarAuthority?: CalendarAuthority | null;
}

function sameWindows(signed: [number, number][], statement: BusyStatement): boolean {
	const pairs = statement.windows
		.map((w): [number, number] => [Date.parse(w.startsAt), Date.parse(w.endsAt)])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	return pairs.length === signed.length && pairs.every(([a, b], i) => a === signed[i][0] && b === signed[i][1]);
}

async function verifyCalendarSigned(input: VerifyBusyInput & { busyStatement: string }): Promise<BusyVerdict> {
	const authority = input.calendarAuthority;
	if (!authority) return unverified('key_unresolved');
	const claimed = b64ToHex(input.signerKeyFingerprint).toLowerCase();
	if (claimed !== authority.signingKey.getFingerprint().toLowerCase()) return unverified('key_mismatch');
	try {
		const f = await verifyCalendarFreeBusy(authority, b64ToBytes(input.busyStatement), b64ToBytes(input.signature));
		const s = input.statement;
		if (
			f.accountId !== s.signerAccountId.toLowerCase() ||
			f.calendarId !== s.calendarId.toLowerCase() ||
			f.itemId !== s.itemId.toLowerCase() ||
			f.privacy !== s.privacy ||
			f.revision !== s.rev ||
			!sameWindows(f.windows, s)
		) {
			return unverified('signature_failed');
		}
		return { trust: 'verified', signedAtMillis: Date.parse(f.issuedAt) };
	} catch {
		return unverified('signature_failed');
	}
}

function unverified(trust: BusyTrust): BusyVerdict {
	return { trust, signedAtMillis: null };
}

export async function verifyBusyWindows(input: VerifyBusyInput): Promise<BusyVerdict> {
	if (!input.signature || !input.signerKeyFingerprint) return unverified('unsigned');
	if (input.busyStatement) return verifyCalendarSigned({ ...input, busyStatement: input.busyStatement });
	if (!input.publicKeyArmored) return unverified('key_unresolved');

	const claimed = b64ToHex(input.signerKeyFingerprint).toLowerCase();
	const previous =
		input.previousKey && input.previousKey.fingerprintHex.toLowerCase() === claimed ? input.previousKey : null;
	if (claimed !== input.directoryKeyFingerprintHex.toLowerCase() && !previous) {
		return unverified('key_mismatch');
	}

	let publicKey: openpgp.Key;
	let signature: openpgp.Signature;
	try {
		publicKey = await openpgp.readKey({ armoredKey: previous ? previous.publicKeyArmored : input.publicKeyArmored });
		signature = await openpgp.readSignature({ binarySignature: b64ToBytes(input.signature) });
	} catch {
		return unverified('signature_failed');
	}

	try {
		const { signatures } = await openpgp.verify({
			message: await openpgp.createMessage({ binary: canonicalise(input.statement) }),
			signature,
			verificationKeys: publicKey,
			format: 'binary'
		});
		if (!signatures.length) return unverified('signature_failed');
		await signatures[0].verified;
		const created = await signatures[0].signature;
		const signedAtMillis = created.packets[0]?.created?.getTime() ?? null;
		if (
			previous &&
			!signedWhileCurrent(input.updatedAtMillis, signedAtMillis ?? undefined, previous.retiredAtMillis)
		) {
			return unverified('signature_failed');
		}
		return { trust: 'verified', signedAtMillis };
	} catch {
		return unverified('signature_failed');
	}
}
