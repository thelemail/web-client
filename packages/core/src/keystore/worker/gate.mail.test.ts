// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeystoreCommand } from '../protocol';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('../idb', () => ({
	getVault: async () => null,
	getAllVaults: async () => [],
	putVault: async () => undefined,
	deleteVault: async () => undefined,
	clearAllVaults: async () => undefined
}));

const { commandAllowed, vaultModeOf } = await import('./gate');
const { productAccounts, vaults } = await import('./state');
type VaultState = import('./state').VaultState;

const LEGACY = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const MAIL = '8e1f4c2a-7b3d-4a5e-b6c9-0d2e3f4a5b6c';
const LOCKED_MAIL = '0f6c9a1e-2b3d-4c5e-8f7a-9b0c1d2e3f40';
const UNKNOWN = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function vault(accountId: string, product?: 'app'): VaultState {
	return { accountId, product } as unknown as VaultState;
}

const accountOnly: KeystoreCommand[] = [
	'opaqueFinishAuth',
	'opaqueCompleteLoginUnlock',
	'opaquePasswordChangeStart',
	'opaqueRecoverySetupStart',
	'opaquePrepareAmkRotation',
	'prepareDeletionProof',
	'prepareKeyRotation',
	'commitKeyRotation',
	'reformatKeyWithUids',
	'commitReformattedKey',
	'sealProductFork',
	'invalidatePersistedVault'
];
const mailContent: KeystoreCommand[] = ['decrypt', 'encrypt', 'encryptToKeys', 'signDetached', 'attachmentBytes', 'getPublicKey', 'sealIndex', 'openIndex', 'loadAliasKeys', 'createAliasKey', 'createSigningDelegationKey', 'listAccountKeys', 'loadAccountKeys', 'lock', 'clear'];
const calendarOnly: KeystoreCommand[] = ['signInvitation', 'signReply', 'signFreeBusy', 'signCalendarGrant', 'createCalendarKey', 'loadCalendarKeys', 'openProductFork'];
const authOnly: KeystoreCommand[] = ['touch', 'prepareProductKeys', 'readProductKeys', 'sealProductHandoff', 'disablePersistent'];

describe('mail worker command gate', () => {
	beforeEach(() => {
		vaults.clear();
		productAccounts.clear();
		vaults.set(LEGACY, vault(LEGACY));
		vaults.set(MAIL, vault(MAIL, 'app'));
		productAccounts.add(LOCKED_MAIL);
	});

	it('classifies each account by the vault it holds', () => {
		expect(vaultModeOf(LEGACY)).toBe('account');
		expect(vaultModeOf(MAIL)).toBe('mail');
		expect(vaultModeOf(LOCKED_MAIL)).toBe('mail');
		expect(vaultModeOf(UNKNOWN)).toBeNull();
	});

	it('refuses account authority to a mail-only vault and keeps it for a legacy one', () => {
		for (const cmd of accountOnly) {
			expect(commandAllowed(cmd, { accountId: MAIL }), `${cmd} on a mail vault`).toBe(false);
			expect(commandAllowed(cmd, { accountId: LOCKED_MAIL }), `${cmd} on a locked mail vault`).toBe(false);
			expect(commandAllowed(cmd, { accountId: LEGACY }), `${cmd} on a legacy vault`).toBe(true);
			expect(commandAllowed(cmd, { accountId: UNKNOWN }), `${cmd} for a new account`).toBe(true);
		}
	});

	it('serves mail content from either vault', () => {
		for (const cmd of mailContent) {
			expect(commandAllowed(cmd, { accountId: MAIL }), `${cmd} on a mail vault`).toBe(true);
			expect(commandAllowed(cmd, { accountId: LEGACY }), `${cmd} on a legacy vault`).toBe(true);
		}
	});

	it('adopts a handoff only where no legacy vault is unlocked', () => {
		for (const cmd of ['adoptHandoff', 'commitHandoff', 'discardHandoff'] as const) {
			expect(commandAllowed(cmd, { accountId: LEGACY })).toBe(false);
			expect(commandAllowed(cmd, { accountId: MAIL })).toBe(true);
			expect(commandAllowed(cmd, { accountId: LOCKED_MAIL })).toBe(true);
			expect(commandAllowed(cmd, { accountId: UNKNOWN })).toBe(true);
		}
	});

	it.each(['openSearchRoot', 'sealSearchArtifact', 'openSearchArtifact', 'deriveSearchDbKey', 'closeSearchSession'] as const)(
		'runs %s for a mail vault and never for a legacy one',
		(cmd) => {
			expect(commandAllowed(cmd, { accountId: MAIL })).toBe(true);
			expect(commandAllowed(cmd, { accountId: LOCKED_MAIL })).toBe(true);
			expect(commandAllowed(cmd, { accountId: LEGACY })).toBe(false);
		}
	);

	it('never runs calendar or auth commands', () => {
		for (const cmd of [...calendarOnly, ...authOnly]) {
			for (const accountId of [LEGACY, MAIL, LOCKED_MAIL, UNKNOWN]) {
				expect(commandAllowed(cmd, { accountId }), `${cmd} for ${accountId}`).toBe(false);
			}
			expect(commandAllowed(cmd, undefined), cmd).toBe(false);
		}
	});

	it('lets account-less commands through on their build mode alone', () => {
		expect(commandAllowed('status', undefined)).toBe(true);
		expect(commandAllowed('opaqueStartAuth', { email: 'calloway@thelemail.test', password: 'x' })).toBe(true);
		expect(commandAllowed('clearAll', undefined)).toBe(true);
		expect(commandAllowed('nonsense' as KeystoreCommand, { accountId: LEGACY })).toBe(false);
	});

	it('keeps one account on the legacy vault while another is mail-only', () => {
		expect(commandAllowed('prepareKeyRotation', { accountId: LEGACY })).toBe(true);
		expect(commandAllowed('prepareKeyRotation', { accountId: MAIL })).toBe(false);
		vaults.set(LEGACY, vault(LEGACY, 'app'));
		expect(commandAllowed('prepareKeyRotation', { accountId: LEGACY })).toBe(false);
		expect(commandAllowed('decrypt', { accountId: LEGACY })).toBe(true);
	});
});
