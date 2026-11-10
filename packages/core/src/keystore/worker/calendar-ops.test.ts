// @vitest-environment node
import * as openpgp from 'openpgp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CalendarAuthority } from '../productkeys/calendar';
import { calendarAuthority, parseCalendarGrant, verifyCalendarFreeBusy, verifyCalendarGrant, verifyCalendarMessage } from '../productkeys/calendar';
import { keyId, sha256 } from '../productkeys/encoding';
import { formatTime } from '../productkeys/fields';
import { DOMAIN, encodeDelegation, productPurposes } from '../productkeys/manifests';
import { fingerprintBytes, generateAuthorityKey, generateCalendarIdentity, publicKeyBytes, publicKeyDigest, signTranscript } from '../productkeys/pgp';
import { PROFILE } from '../productkeys/profiles';
import type { VaultState } from './state';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('@protontech/crypto/srp', () => ({}));

const product = vi.hoisted(() => ({ value: 'calendar' }));
vi.mock('../../products', () => ({
	get currentProduct() {
		return product.value;
	},
	isProductVault: true
}));

const ops = await import('./calendar-ops');
const { handleSignDetached } = await import('./content-ops');
const { vaults } = await import('./state');

const accountId = '5b6f1c34-7d0e-4c3a-9f61-2a1d3b6c8e90';
const otherId = '0a3d1f5e-2b7c-4e9a-8d61-7f2c4b9e1a03';
let identity: openpgp.PrivateKey;
let authority: CalendarAuthority;

async function authorityFor(account: string, cal: openpgp.PrivateKey): Promise<CalendarAuthority> {
	const aak = await generateAuthorityKey();
	const digest = await publicKeyDigest(cal.toPublic());
	const calId = keyId(account, fingerprintBytes(cal));
	const record = encodeDelegation({
		accountId: account,
		authorityKeyId: keyId(account, fingerprintBytes(aak)),
		authorityEpoch: 1,
		product: 'calendar',
		productKeyEpoch: 1,
		signingKeyId: calId,
		signingProfileId: PROFILE.calendarIdentity,
		signingPublicKeyDigest: digest,
		recipientKeyId: calId,
		recipientProfileId: PROFILE.calendarIdentity,
		recipientPublicKeyDigest: digest,
		purposes: productPurposes('calendar'),
		issuedAt: formatTime(new Date()),
		delegationRevision: 1,
		previousDelegationHash: null
	});
	const sig = await signTranscript(DOMAIN.delegation, record, aak);
	return calendarAuthority(account, publicKeyBytes(aak), 1, record, sig, publicKeyBytes(cal));
}

function vault(productTag?: 'app' | 'calendar'): VaultState {
	return {
		accountId,
		email: 'ada@thelemail.test',
		authScheme: 'opaque_v1',
		armoredEncryptedPrivateKey: '',
		privateKey: identity,
		keyPassword: `calendar:${accountId}`,
		accountKeys: new Map(),
		keyVersion: 1,
		aliasKeys: new Map(),
		aliasCurrent: new Map(),
		product: productTag
	};
}

const ctx = { productKeyEpoch: 1, delegationRevision: 1 };

beforeAll(async () => {
	identity = await generateCalendarIdentity();
	authority = await authorityFor(accountId, identity);
});

describe('typed calendar signatures', () => {
	it('signs an invitation the recipient verifies against the delegation', async () => {
		vaults.set(accountId, vault('calendar'));
		const content = new TextEncoder().encode('{"event":1}');
		const res = await ops.handleSignInvitation({
			accountId, ...ctx, calendarId: otherId, eventId: otherId, uid: 'e@thelemail.test', method: 'REQUEST', sequence: 0,
			recipients: [otherId], content, membershipRevision: 1, operationId: otherId
		});
		if (!res.ok) throw new Error(res.code);
		const m = await verifyCalendarMessage(authority, res.statement, res.signature);
		expect(m.contentDigest).toEqual(await sha256(content));
		expect(m.organizerAccountId).toBe(accountId);
	});

	it('signs free/busy and grants that verify', async () => {
		vaults.set(accountId, vault('calendar'));
		const busy = await ops.handleSignFreeBusy({
			accountId, ...ctx, calendarId: otherId, itemId: otherId, privacy: 'busy', revision: 1, rangeStart: 0, rangeEnd: 1000, windows: [[10, 20]]
		});
		if (!busy.ok) throw new Error(busy.code);
		await verifyCalendarFreeBusy(authority, busy.statement, busy.signature);
	});

	it('refuses outside a handoff-adopted calendar vault', async () => {
		const args = { accountId, ...ctx, calendarId: otherId, itemId: otherId, privacy: 'busy' as const, revision: 1, rangeStart: 0, rangeEnd: 1000, windows: [] as [number, number][] };
		vaults.set(accountId, vault());
		expect(await ops.handleSignFreeBusy(args)).toEqual({ ok: false, code: 'not_calendar' });
		vaults.set(accountId, vault('app'));
		expect(await ops.handleSignFreeBusy(args)).toEqual({ ok: false, code: 'not_calendar' });
		vaults.set(accountId, vault('calendar'));
		product.value = 'app';
		try {
			expect(await ops.handleSignFreeBusy(args)).toEqual({ ok: false, code: 'not_calendar' });
		} finally {
			product.value = 'calendar';
		}
		vaults.delete(accountId);
		expect(await ops.handleSignFreeBusy(args)).toEqual({ ok: false, code: 'locked' });
	});
});

describe('calendar keys', () => {
	it('wraps a new calendar key to calendar identities with signed grants and loads it back', async () => {
		vaults.set(accountId, vault('calendar'));
		const created = await ops.handleCreateCalendarKey({
			accountId, ...ctx, calendarId: otherId, keyVersion: 1,
			members: [{ accountId, role: 'owner', recipientPublicKey: publicKeyBytes(identity) }]
		});
		if (!created.ok) throw new Error(created.code);
		const [grant] = created.grants;
		const stmt = await verifyCalendarGrant(authority, grant.grantStatement, grant.grantSignature);
		expect(stmt.wrappedKeyDigest).toEqual(await sha256(grant.wrappedPrivateKey));
		expect(stmt.keyFingerprint).toEqual(created.keyFingerprint);
		expect(parseCalendarGrant(grant.grantStatement).recipientPublicKeyDigest).toEqual(await publicKeyDigest(identity.toPublic()));

		const hex = Array.from(created.keyFingerprint, (b) => b.toString(16).padStart(2, '0')).join('');
		const loaded = await ops.handleLoadCalendarKeys({
			accountId,
			grants: [{ calendarId: otherId, keyVersion: 1, calendarKeyFingerprintHex: hex, wrappedPrivateKey: grant.wrappedPrivateKey, isCurrent: true }]
		});
		expect(loaded).toEqual({ ok: true, loaded: [hex], failed: [] });
	});

	it('refuses a mail key as a member recipient', async () => {
		vaults.set(accountId, vault('calendar'));
		const { publicKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'bruno@thelemail.test' }], format: 'object', config: { v6Keys: true } });
		const res = await ops.handleCreateCalendarKey({
			accountId, ...ctx, calendarId: otherId, keyVersion: 1,
			members: [{ accountId: otherId, role: 'editor', recipientPublicKey: publicKeyBytes(publicKey) }]
		});
		expect(res).toEqual({ ok: false, code: 'invalid_recipient_key' });
	});
});

describe('caller-chosen signatures', () => {
	it('never signs arbitrary bytes with an adopted calendar identity', async () => {
		vaults.set(accountId, vault('calendar'));
		expect(await handleSignDetached({ accountId, data: new Uint8Array([1, 2, 3]) })).toEqual({ ok: false, code: 'product_identity' });
	});

	it('still signs for a forked vault on the calendar origin', async () => {
		vaults.set(accountId, vault());
		const res = await handleSignDetached({ accountId, data: new Uint8Array([1, 2, 3]) });
		expect(res.ok).toBe(true);
		vaults.delete(accountId);
	});
});
