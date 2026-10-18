import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupDirectory = vi.fn();
const verifyDirectoryLookup = vi.fn();

vi.mock('./lookup', () => ({ lookupDirectory: (...a: unknown[]) => lookupDirectory(...a) }));
vi.mock('./verify', () => ({ verifyDirectoryLookup: (...a: unknown[]) => verifyDirectoryLookup(...a) }));

import { verifiedMemberKey } from './memberKey';
import { DirectoryVerificationError } from './errors';

describe('verifiedMemberKey', () => {
	beforeEach(() => {
		lookupDirectory.mockReset();
		verifyDirectoryLookup.mockReset();
		lookupDirectory.mockResolvedValue({ publicKeyArmored: 'served-armored' });
	});

	it('returns the verified key when the record belongs to the member', async () => {
		verifyDirectoryLookup.mockResolvedValue({
			statement: { accountId: 'acc-2', address: 'nora@example.org' },
			publicKeyArmored: 'verified-armored'
		});
		await expect(verifiedMemberKey(' Nora@Example.org ', 'acc-2')).resolves.toBe('verified-armored');
		expect(verifyDirectoryLookup).toHaveBeenCalledWith({ publicKeyArmored: 'served-armored' }, 'nora@example.org');
	});

	it('refuses a record that belongs to another account', async () => {
		verifyDirectoryLookup.mockResolvedValue({
			statement: { accountId: 'acc-3', address: 'nora@example.org' },
			publicKeyArmored: 'verified-armored'
		});
		const err = await verifiedMemberKey('nora@example.org', 'acc-2').catch((e) => e);
		expect(err).toBeInstanceOf(DirectoryVerificationError);
		expect(err.code).toBe('address_mismatch');
	});
});
