import { describe, expect, it } from 'vitest';
import { commandVaultModes, type KeystoreCommand } from './protocol';

const credentialCommands: KeystoreCommand[] = [
	'prepareLogin',
	'verifyLoginProof',
	'completeLoginUnlock',
	'opaqueStartRegistration',
	'opaqueFinishRegistration',
	'opaqueStartAuth',
	'opaqueFinishAuth',
	'opaqueCompleteLoginUnlock',
	'opaquePrepareCredentialReset',
	'opaqueFinishCredentialReset',
	'opaquePrepareAmkRotation',
	'opaqueFinishAmkRotation',
	'opaquePasswordChangeStart',
	'opaquePasswordChangeCommit',
	'prepareRecoverySetup',
	'prepareRecoveryLogin',
	'completeRecoveryUnlock',
	'prepareCredentialReset',
	'prepareDeletionProof',
	'preparePasswordChangeCredentials',
	'commitPasswordChange',
	'migrationStartRegistration',
	'migrationFinishStage'
];

const keyIssuingCommands: KeystoreCommand[] = [
	'createAliasKey',
	'createSigningDelegationKey',
	'reformatKeyWithUids',
	'commitReformattedKey',
	'loadAliasKeys',
	'unloadAliasKeys'
];

describe('commandVaultModes', () => {
	it('classifies every command', () => {
		for (const [cmd, modes] of Object.entries(commandVaultModes)) {
			expect(modes.length, `${cmd} has no vault mode`).toBeGreaterThan(0);
			expect(modes, `${cmd} must stay available to the account vault`).toContain('account');
		}
	});

	it('denies credential and recovery commands to a product vault', () => {
		for (const cmd of credentialCommands) {
			expect(commandVaultModes[cmd], `${cmd} must not reach a product vault`).not.toContain(
				'product'
			);
		}
	});

	it('denies key issuance to a product vault', () => {
		for (const cmd of keyIssuingCommands) {
			expect(commandVaultModes[cmd], `${cmd} must not reach a product vault`).not.toContain(
				'product'
			);
		}
	});

	it('allows a product vault the crypto it needs', () => {
		for (const cmd of ['decrypt', 'encrypt', 'signDetached', 'sealIndex', 'openIndex'] as const) {
			expect(commandVaultModes[cmd]).toContain('product');
		}
	});

	it('allows a product vault to lock and persist itself', () => {
		for (const cmd of ['status', 'lock', 'clear', 'enrollPersistent'] as const) {
			expect(commandVaultModes[cmd]).toContain('product');
		}
	});
});
