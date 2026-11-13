// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { KeystoreCommand } from '../protocol';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('../../products', () => ({ isProductVault: true, isAuthOrigin: false, currentProduct: 'calendar' }));
vi.mock('../idb', () => ({
	getVault: async () => null,
	getAllVaults: async () => [],
	putVault: async () => undefined,
	deleteVault: async () => undefined,
	clearAllVaults: async () => undefined
}));

const { commandAllowed, vaultModeOf } = await import('./gate');

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';

describe('calendar worker command gate', () => {
	it('treats every account as a calendar vault', () => {
		expect(vaultModeOf(ACCOUNT)).toBe('calendar');
	});

	it('runs calendar and shared content commands', () => {
		for (const cmd of ['signInvitation', 'signFreeBusy', 'createCalendarKey', 'loadCalendarKeys', 'openProductFork', 'adoptHandoff', 'commitHandoff', 'decrypt', 'encrypt', 'sealIndex', 'status', 'lock'] as KeystoreCommand[]) {
			expect(commandAllowed(cmd, { accountId: ACCOUNT }), cmd).toBe(true);
		}
	});

	it.each(['openSearchRoot', 'sealSearchArtifact', 'openSearchArtifact', 'deriveSearchDbKey', 'closeSearchSession'] as KeystoreCommand[])('refuses %s', (cmd) => {
		expect(commandAllowed(cmd, { accountId: ACCOUNT })).toBe(false);
		expect(commandAllowed(cmd, undefined)).toBe(false);
	});

	it('refuses mail keyring, account and auth commands', () => {
		for (const cmd of ['loadAliasKeys', 'loadAccountKeys', 'listAccountKeys', 'createAliasKey', 'opaqueStartAuth', 'opaqueCompleteLoginUnlock', 'prepareKeyRotation', 'sealProductFork', 'prepareProductKeys', 'touch'] as KeystoreCommand[]) {
			expect(commandAllowed(cmd, { accountId: ACCOUNT }), cmd).toBe(false);
			expect(commandAllowed(cmd, undefined), cmd).toBe(false);
		}
	});
});
