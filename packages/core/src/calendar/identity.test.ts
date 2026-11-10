// @vitest-environment node
import * as openpgp from 'openpgp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarIdentityResponse } from '$core/api/calendars';

const h = vi.hoisted(() => ({ signerArmored: '', signerFingerprint: '', lookup: vi.fn() }));

vi.mock('$core/directory/signing-key', () => ({
	get DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED() {
		return h.signerArmored;
	},
	get DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX() {
		return h.signerFingerprint;
	}
}));
vi.mock('$core/directory/tlog/policy', () => ({ TLOG_POLICY: null }));
vi.mock('$core/directory/tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/directory/seen-idb', () => ({ getSeen: async () => null, upsertSeen: async () => undefined }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));
vi.mock('$core/api/calendars', () => ({ lookupCalendarIdentity: h.lookup }));

import { ApiCallError } from '$core/api/types';
import { bytesToHex } from '$core/crypto';
import { signStatement, toBase64 } from '$core/directory/fixtures/signedStatement';
import { keyId, sha256 } from '$core/keystore/productkeys/encoding';
import { transcriptHash } from '$core/keystore/productkeys/envelope';
import { formatTime } from '$core/keystore/productkeys/fields';
import { DOMAIN, encodeDelegation, productPurposes } from '$core/keystore/productkeys/manifests';
import { fingerprintBytes, generateAuthorityKey, generateCalendarIdentity, publicKeyBytes, publicKeyDigest, signTranscript } from '$core/keystore/productkeys/pgp';
import { PROFILE } from '$core/keystore/productkeys/profiles';
import { memoryCalendarDb } from './db';
import { CalendarIdentityError, forgetCalendarIdentities, resolveCalendarIdentity, resolveCalendarRecipient } from './identity';

const self = '9c1e2a3b-4d5f-4a6b-8c7d-0e1f2a3b4c5d';
const peer = '5b6f1c34-7d0e-4c3a-9f61-2a1d3b6c8e90';
const email = 'bruno@thelemail.test';
let signer: openpgp.PrivateKey;

async function signBytes(raw: Uint8Array): Promise<string> {
	const sig = await openpgp.sign({ message: await openpgp.createMessage({ binary: raw }), signingKeys: signer, detached: true, format: 'binary' });
	return toBase64(sig as Uint8Array);
}

interface Built {
	res: CalendarIdentityResponse;
	cal: openpgp.PrivateKey;
}

async function build(opts: { revision?: number; accountForAddress?: string; mutate?: (s: Record<string, unknown>) => void } = {}): Promise<Built> {
	const revision = opts.revision ?? 1;
	const aak = await generateAuthorityKey();
	const cal = await generateCalendarIdentity();
	const digest = await publicKeyDigest(cal.toPublic());
	const calId = keyId(peer, fingerprintBytes(cal));
	const records: { revision: number; record: string; signature: string }[] = [];
	let previous: Uint8Array | null = null;
	let current = new Uint8Array();
	for (let r = 1; r <= revision; r++) {
		current = encodeDelegation({
			accountId: peer, authorityKeyId: keyId(peer, fingerprintBytes(aak)), authorityEpoch: 1, product: 'calendar', productKeyEpoch: 1,
			signingKeyId: calId, signingProfileId: PROFILE.calendarIdentity, signingPublicKeyDigest: digest,
			recipientKeyId: calId, recipientProfileId: PROFILE.calendarIdentity, recipientPublicKeyDigest: digest,
			purposes: productPurposes('calendar'), issuedAt: formatTime(new Date()), delegationRevision: r, previousDelegationHash: previous
		});
		records.push({ revision: r, record: toBase64(current), signature: toBase64(await signTranscript(DOMAIN.delegation, current, aak)) });
		previous = await transcriptHash(DOMAIN.delegation, current);
	}
	const statement: Record<string, unknown> = {
		accountId: peer,
		authorityEpoch: 1,
		authorityKeyDigest: bytesToHex(await sha256(publicKeyBytes(aak))),
		delegationHash: bytesToHex(previous as Uint8Array),
		delegationRevision: revision,
		issuedAt: '2026-11-09T12:00:00Z',
		product: 'calendar',
		signingKeyDigest: bytesToHex(digest),
		signingKeyFingerprint: h.signerFingerprint,
		type: 'thelemail-product-identity-statement/v1',
		version: 1
	};
	opts.mutate?.(statement);
	const statementRaw = new TextEncoder().encode(JSON.stringify(statement));
	const address = await signStatement(signer, {
		address: email, accountId: opts.accountForAddress ?? peer, issuedAt: '2026-11-09T12:00:00Z',
		keyAlgorithm: 'openpgp-curve25519-v6', keyFingerprint: 'ab'.repeat(32), signingKeyFingerprint: h.signerFingerprint, version: 1
	});
	return {
		cal,
		res: {
			state: 'published',
			accountId: peer,
			authorityKey: toBase64(publicKeyBytes(aak)),
			authorityEpoch: 1,
			delegations: records,
			signingKey: toBase64(publicKeyBytes(cal)),
			statement: toBase64(statementRaw),
			statementSignature: await signBytes(statementRaw),
			addressStatement: address.directoryStatementRaw,
			addressSignature: address.directorySignature
		}
	};
}

async function code(p: Promise<unknown>): Promise<string> {
	try {
		await p;
		return '';
	} catch (err) {
		if (err instanceof CalendarIdentityError) return err.code;
		if (err instanceof Error && 'code' in err) return String((err as { code: unknown }).code);
		throw err;
	}
}

beforeAll(async () => {
	const { privateKey } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'directory@thelemail.test' }], format: 'object', config: { v6Keys: true } });
	signer = privateKey;
	h.signerArmored = privateKey.toPublic().armor();
	h.signerFingerprint = privateKey.getFingerprint().toLowerCase();
});

beforeEach(() => {
	forgetCalendarIdentities();
	h.lookup.mockReset();
});

describe('resolveCalendarIdentity', () => {
	it('verifies the address, the identity statement and the delegation chain', async () => {
		const { res, cal } = await build({ revision: 2 });
		h.lookup.mockResolvedValue(res);
		const id = await resolveCalendarIdentity(memoryCalendarDb(), self, email);
		expect(id?.accountId).toBe(peer);
		expect(id?.authority.signingKey.getFingerprint()).toBe(cal.getFingerprint());
		expect(id?.authority.delegation.delegationRevision).toBe(2);
	});

	it('answers null for an address outside Thelemail and for one still pending', async () => {
		h.lookup.mockRejectedValue(new ApiCallError(404, null, 'not found'));
		expect(await resolveCalendarIdentity(memoryCalendarDb(), self, email)).toBeNull();
		forgetCalendarIdentities();
		const { res } = await build();
		h.lookup.mockResolvedValue({ state: 'pending', accountId: peer, addressStatement: res.addressStatement, addressSignature: res.addressSignature });
		expect(await resolveCalendarIdentity(memoryCalendarDb(), self, email)).toBeNull();
		forgetCalendarIdentities();
		expect(await resolveCalendarRecipient(memoryCalendarDb(), self, email)).toEqual({ kind: 'pending', accountId: peer, email });
	});

	it('refuses a pending answer whose address belongs to another account', async () => {
		const { res } = await build({ accountForAddress: self });
		h.lookup.mockResolvedValue({ state: 'pending', accountId: peer, addressStatement: res.addressStatement, addressSignature: res.addressSignature });
		expect(await code(resolveCalendarRecipient(memoryCalendarDb(), self, email))).toBe('unverified');
	});

	it('refuses a served key the delegation does not name', async () => {
		const { res } = await build();
		res.signingKey = toBase64(publicKeyBytes(await generateCalendarIdentity()));
		h.lookup.mockResolvedValue(res);
		expect(await code(resolveCalendarIdentity(memoryCalendarDb(), self, email))).toBe('authority');
	});

	it('refuses an identity statement for another delegation', async () => {
		const { res } = await build({ mutate: (s) => (s.delegationHash = '00'.repeat(32)) });
		h.lookup.mockResolvedValue(res);
		expect(await code(resolveCalendarIdentity(memoryCalendarDb(), self, email))).toBe('unverified');
	});

	it('refuses an address bound to a different account', async () => {
		const { res } = await build({ accountForAddress: self });
		h.lookup.mockResolvedValue(res);
		expect(await code(resolveCalendarIdentity(memoryCalendarDb(), self, email))).toBe('unverified');
	});

	it('refuses an identity older than one this device has seen', async () => {
		const db = memoryCalendarDb();
		h.lookup.mockResolvedValue((await build({ revision: 2 })).res);
		await resolveCalendarIdentity(db, self, email);
		forgetCalendarIdentities();
		h.lookup.mockResolvedValue((await build({ revision: 1 })).res);
		expect(await code(resolveCalendarIdentity(db, self, email))).toBe('rolled_back');
	});
});
