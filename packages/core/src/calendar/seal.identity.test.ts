// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCalendarKey = vi.fn();
const createAliasKey = vi.fn();
const senderKey = vi.fn();
const resolveCalendarIdentity = vi.fn();
const calendarSigningContext = vi.fn();

vi.mock('$core/stores/calendarKeys.svelte', () => ({ calendarKeys: { ready: vi.fn(), load: vi.fn(), publicKeyFor: vi.fn() } }));
vi.mock('$core/stores/aliasKeys.svelte', () => ({ aliasKeys: { ready: vi.fn(), load: vi.fn() } }));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { createCalendarKey, createAliasKey } }));
vi.mock('$core/mail/send', () => ({ senderKey }));
vi.mock('./identity', () => ({ resolveCalendarIdentity }));
vi.mock('./signing', () => ({ calendarSigningContext }));
vi.mock('./db', () => ({ idbCalendarDb: {} }));

const OWN = new Uint8Array([1, 2, 3]);
const PEER = new Uint8Array([4, 5, 6]);
const ctx = { productKeyEpoch: 1, delegationRevision: 2, signingKey: OWN };

describe('calendar keys minted for calendar identities', () => {
	beforeEach(() => {
		createCalendarKey.mockReset();
		createAliasKey.mockReset();
		senderKey.mockReset();
		resolveCalendarIdentity.mockReset();
		calendarSigningContext.mockReset().mockResolvedValue(ctx);
	});

	it('wraps to calendar identities and returns signed grants, never touching the mail key', async () => {
		const { mintSharedCalendarKey } = await import('./seal');
		resolveCalendarIdentity.mockResolvedValue({ accountId: 'peer', signingKey: PEER });
		createCalendarKey.mockResolvedValue({
			ok: true,
			publicKeyArmored: 'cal-pub',
			keyFingerprint: new Uint8Array(32),
			grants: [
				{ accountId: 'me', role: 'owner', memberKeyFingerprint: new Uint8Array(32), wrappedPrivateKey: new Uint8Array([7]), grantStatement: new Uint8Array([8]), grantSignature: new Uint8Array([9]) }
			]
		});
		const minted = await mintSharedCalendarKey('me', 'cal-1', 3, [
			{ accountId: 'me', email: 'ada@thelemail.test', role: 'owner' },
			{ accountId: 'peer', email: 'bruno@thelemail.test', role: 'editor' }
		]);
		expect(createCalendarKey).toHaveBeenCalledWith(expect.objectContaining({
			accountId: 'me', calendarId: 'cal-1', keyVersion: 3, productKeyEpoch: 1, delegationRevision: 2,
			members: [
				{ accountId: 'me', role: 'owner', recipientPublicKey: OWN },
				{ accountId: 'peer', role: 'editor', recipientPublicKey: PEER }
			]
		}));
		expect(minted?.grants[0].grantStatement).toBeTruthy();
		expect(senderKey).not.toHaveBeenCalled();
		expect(createAliasKey).not.toHaveBeenCalled();
	});

	it('names the members who have no calendar identity instead of falling back to their mail key', async () => {
		const { mintSharedCalendarKey, CalendarMembersWithoutIdentity } = await import('./seal');
		resolveCalendarIdentity.mockResolvedValue(null);
		const err = await mintSharedCalendarKey('me', 'cal-1', 1, [
			{ accountId: 'me', email: 'ada@thelemail.test', role: 'owner' },
			{ accountId: 'peer', email: 'bruno@thelemail.test', role: 'editor' }
		]).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CalendarMembersWithoutIdentity);
		expect((err as InstanceType<typeof CalendarMembersWithoutIdentity>).emails).toEqual(['bruno@thelemail.test']);
		expect(createCalendarKey).not.toHaveBeenCalled();
		expect(createAliasKey).not.toHaveBeenCalled();
	});

	it('leaves accounts without a calendar identity on the existing path', async () => {
		const { mintSharedCalendarKey } = await import('./seal');
		calendarSigningContext.mockResolvedValue(null);
		expect(await mintSharedCalendarKey('me', 'cal-1', 1, [])).toBeNull();
	});
});
