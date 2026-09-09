// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';

import { generateDelegationKey } from './delegationKey';

const email = 'billing@acme.test';

describe('generateDelegationKey', () => {
	it('produces a sign-only certificate with no encryption key', async () => {
		const generated = await generateDelegationKey({ email, validForDays: 365 });
		const key = await openpgp.readKey({ armoredKey: generated.publicKeyArmored });

		expect(key.getSubkeys()).toHaveLength(0);
		await expect(key.getEncryptionKey()).rejects.toThrow();
		await expect(key.getSigningKey()).resolves.toBeTruthy();
	});

	it('binds exactly one user id to the delegated address', async () => {
		const generated = await generateDelegationKey({ email, validForDays: 365 });
		const key = await openpgp.readKey({ armoredKey: generated.publicKeyArmored });

		const ids = key.getUserIDs();
		expect(ids).toHaveLength(1);
		expect(ids[0]).toContain(email);
	});

	it('sets an expiry at the requested distance', async () => {
		const now = Date.UTC(2026, 8, 9, 12, 0, 0);
		const generated = await generateDelegationKey({ email, validForDays: 30, now });
		const key = await openpgp.readKey({ armoredKey: generated.publicKeyArmored });

		const expiry = await key.getExpirationTime();
		expect(expiry).toBeInstanceOf(Date);
		expect(new Date(generated.notAfter).getTime()).toBe((expiry as Date).getTime());

		const created = key.getCreationTime().getTime();
		expect((expiry as Date).getTime() - created).toBe(30 * 24 * 60 * 60 * 1000);
	});

	it('backdates creation so a fast client clock still yields a usable key', async () => {
		const now = Date.UTC(2026, 8, 9, 12, 0, 0);
		const generated = await generateDelegationKey({ email, validForDays: 365, now });
		const key = await openpgp.readKey({ armoredKey: generated.publicKeyArmored });

		expect(key.getCreationTime().getTime()).toBeLessThan(now);
	});

	it('mints a revocation certificate for the same key', async () => {
		const generated = await generateDelegationKey({ email, validForDays: 365 });
		const live = await openpgp.readKey({ armoredKey: generated.publicKeyArmored });
		const revoked = await openpgp.readKey({ armoredKey: generated.revokedPublicKeyArmored });

		expect(revoked.getFingerprint()).toBe(live.getFingerprint());
		expect(await live.isRevoked()).toBe(false);
		expect(await revoked.isRevoked()).toBe(true);
	});

	it('returns a private key that never leaves as part of the public certificates', async () => {
		const generated = await generateDelegationKey({ email, validForDays: 365 });

		expect(generated.privateKeyArmored).toContain('PRIVATE KEY BLOCK');
		expect(generated.publicKeyArmored).not.toContain('PRIVATE KEY BLOCK');
		expect(generated.revokedPublicKeyArmored).not.toContain('PRIVATE KEY BLOCK');
	});
});