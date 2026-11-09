import type { CalendarMemberGrant, CalendarRole } from '$core/api/calendars';
import { verifiedMemberKey } from '$core/directory/memberKey';
import { hexToB64, textToB64 } from '$core/keys/encode';
import { keystore } from '$core/keystore/keystore-client';
import { senderKey } from '$core/mail/send';
import { m } from '$paraglide/messages.js';
import { SealError, type MintedCalendarKey } from '../seal';

export async function mintOwnCalendarKeyForMailKey(accountId: string): Promise<MintedCalendarKey> {
	const own = await senderKey(accountId);
	const created = await keystore.createAliasKey({
		accountId,
		email: '',
		displayName: 'Thelemail calendar',
		recipients: [{ accountId, publicKeyArmored: own.publicKeyArmored }]
	});
	if (!created.ok) {
		throw new SealError(created.code === 'locked' ? 'locked' : 'unknown', m.cal_seal_key_failed());
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

export interface MailKeyMember {
	accountId: string;
	email: string;
	role: CalendarRole;
}

export async function mintSharedCalendarKeyForMailKeys(
	accountId: string,
	members: MailKeyMember[],
	onVerify: (email: string) => void
): Promise<MintedCalendarKey> {
	const recipients: (MailKeyMember & { publicKeyArmored: string })[] = [];
	for (const member of members) {
		onVerify(member.email);
		recipients.push({ ...member, publicKeyArmored: await verifiedMemberKey(member.email, member.accountId) });
	}
	const created = await keystore.createAliasKey({
		accountId,
		email: '',
		displayName: 'Thelemail calendar',
		recipients: recipients.map((r) => ({ accountId: r.accountId, publicKeyArmored: r.publicKeyArmored }))
	});
	if (!created.ok) {
		throw new Error(created.code === 'locked' ? m.cal_caldlg_unlock() : m.cal_caldlg_key_failed());
	}
	const grants: CalendarMemberGrant[] = created.grants.map((g) => ({
		accountId: g.accountId,
		role: recipients.find((r) => r.accountId === g.accountId)?.role ?? 'editor',
		memberKeyFingerprint: hexToB64(g.memberKeyFingerprintHex),
		wrappedPrivateKey: textToB64(g.wrappedPrivateKeyArmored)
	}));
	return {
		key: { publicKeyArmored: created.publicKeyArmored, fingerprintB64: hexToB64(created.keyFingerprintHex), fingerprintHex: created.keyFingerprintHex },
		grants
	};
}
