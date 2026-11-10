// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { CalendarAuthority } from '$core/keystore/productkeys/calendar';
import { calendarAuthority, encodeCalendarFreeBusy, CALENDAR_DOMAIN, CALENDAR_TYPE } from '$core/keystore/productkeys/calendar';
import { keyId } from '$core/keystore/productkeys/encoding';
import { formatTime } from '$core/keystore/productkeys/fields';
import { DOMAIN, encodeDelegation, productPurposes } from '$core/keystore/productkeys/manifests';
import { fingerprintBytes, generateAuthorityKey, generateCalendarIdentity, publicKeyBytes, publicKeyDigest, signTranscript } from '$core/keystore/productkeys/pgp';
import { PROFILE } from '$core/keystore/productkeys/profiles';
import type * as openpgp from 'openpgp';
import type { BusyStatement } from './busycanon';
import { verifyBusyWindows } from './verifybusy';

const signer = 'cc000000-0000-4000-8000-000000000003';
const statement: BusyStatement = {
	calendarId: 'aa000000-0000-4000-8000-000000000001',
	itemId: 'bb000000-0000-4000-8000-000000000002',
	privacy: 'busy',
	rev: 2,
	signerAccountId: signer,
	windows: [{ startsAt: '2026-09-07T14:00:00.000Z', endsAt: '2026-09-07T15:00:00.000Z' }]
};

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
let authority: CalendarAuthority;
let cal: openpgp.PrivateKey;

async function signed(edit: Partial<{ itemId: string; revision: number }> = {}) {
	const start = Date.parse(statement.windows[0].startsAt);
	const raw = encodeCalendarFreeBusy({
		accountId: signer, calendarId: statement.calendarId, itemId: edit.itemId ?? statement.itemId, privacy: 'busy',
		revision: edit.revision ?? statement.rev, rangeStart: start - 86400000, rangeEnd: start + 86400000,
		windows: [[start, Date.parse(statement.windows[0].endsAt)]], productKeyEpoch: 1, delegationRevision: 1, issuedAt: formatTime(new Date())
	});
	return { busyStatement: b64(raw), signature: b64(await signTranscript(CALENDAR_DOMAIN[CALENDAR_TYPE.freeBusy], raw, cal)) };
}

beforeAll(async () => {
	const aak = await generateAuthorityKey();
	cal = await generateCalendarIdentity();
	const digest = await publicKeyDigest(cal.toPublic());
	const id = keyId(signer, fingerprintBytes(cal));
	const record = encodeDelegation({
		accountId: signer, authorityKeyId: keyId(signer, fingerprintBytes(aak)), authorityEpoch: 1, product: 'calendar', productKeyEpoch: 1,
		signingKeyId: id, signingProfileId: PROFILE.calendarIdentity, signingPublicKeyDigest: digest, recipientKeyId: id,
		recipientProfileId: PROFILE.calendarIdentity, recipientPublicKeyDigest: digest, purposes: productPurposes('calendar'),
		issuedAt: formatTime(new Date()), delegationRevision: 1, previousDelegationHash: null
	});
	authority = await calendarAuthority(signer, publicKeyBytes(aak), 1, record, await signTranscript(DOMAIN.delegation, record, aak), publicKeyBytes(cal));
});

describe('calendar-signed busy windows', () => {
	const base = () => ({ statement, publicKeyArmored: '', directoryKeyFingerprintHex: '', signerKeyFingerprint: b64(fingerprintBytes(cal)) });

	it('verifies a statement signed by the delegated calendar identity', async () => {
		const verdict = await verifyBusyWindows({ ...base(), ...(await signed()), calendarAuthority: authority });
		expect(verdict.trust).toBe('verified');
	});

	it('refuses a statement for another item or revision', async () => {
		expect((await verifyBusyWindows({ ...base(), ...(await signed({ itemId: 'dd000000-0000-4000-8000-000000000004' })), calendarAuthority: authority })).trust).toBe('signature_failed');
		expect((await verifyBusyWindows({ ...base(), ...(await signed({ revision: 3 })), calendarAuthority: authority })).trust).toBe('signature_failed');
	});

	it('refuses a mail fingerprint on a calendar statement and a missing identity', async () => {
		const s = await signed();
		expect((await verifyBusyWindows({ ...base(), ...s, signerKeyFingerprint: b64(new Uint8Array(32)), calendarAuthority: authority })).trust).toBe('key_mismatch');
		expect((await verifyBusyWindows({ ...base(), ...s, calendarAuthority: null })).trust).toBe('key_unresolved');
	});
});
