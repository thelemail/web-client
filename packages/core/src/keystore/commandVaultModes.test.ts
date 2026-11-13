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
	'migrationFinishStage',
	'migrationFinalized'
];

const keyIssuingCommands: KeystoreCommand[] = [
	'createAliasKey',
	'createSigningDelegationKey',
	'loadAliasKeys',
	'unloadAliasKeys',
	'loadAccountKeys',
	'listAccountKeys',
	'prepareKeyRotation',
	'commitKeyRotation',
	'abandonKeyRotation'
];

describe('commandVaultModes', () => {
	it('classifies every command', () => {
		for (const [cmd, modes] of Object.entries(commandVaultModes)) {
			expect(modes.length, `${cmd} has no vault mode`).toBeGreaterThan(0);
			for (const mode of modes) {
				expect(['account', 'mail', 'calendar', 'auth'], `${cmd} has an unknown mode`).toContain(mode);
			}
		}
	});

	it('keeps mail content, alias keys, legacy SRP and forks out of the auth vault', () => {
		const auth = Object.entries(commandVaultModes)
			.filter(([, modes]) => modes.includes('auth'))
			.map(([cmd]) => cmd);
		for (const cmd of [
			'decrypt',
			'encrypt',
			'encryptToKeys',
			'signDetached',
			'attachmentHeader',
			'attachmentBytes',
			'sealIndex',
			'openIndex',
			'getPublicKey',
			'sealProductFork',
			'openProductFork',
			'prepareLogin',
			'completeLoginUnlock',
			'migrationStartRegistration',
			...keyIssuingCommands
		]) {
			expect(auth, `${cmd} must not reach the auth vault`).not.toContain(cmd);
		}
		expect(auth).toContain('opaqueCompleteLoginUnlock');
		expect(auth).toContain('touch');
	});

	it('re-signs the mail key with its addresses in the account or auth vault only', () => {
		for (const cmd of ['reformatKeyWithUids', 'commitReformattedKey'] as const) {
			expect(commandVaultModes[cmd]).toEqual(['account', 'auth']);
		}
	});

	it('gives touch to the auth vault alone', () => {
		expect(commandVaultModes.touch).toEqual(['auth']);
	});

	it('keeps the fork ends on opposite sides of the boundary', () => {
		expect(commandVaultModes.sealProductFork).toEqual(['account']);
		expect(commandVaultModes.openProductFork).toEqual(['calendar']);
	});

	it('denies credential and recovery commands to a product vault', () => {
		for (const cmd of credentialCommands) {
			for (const mode of ['mail', 'calendar'] as const) {
				expect(commandVaultModes[cmd], `${cmd} must not reach a ${mode} vault`).not.toContain(mode);
			}
		}
	});

	it('denies key issuance and rotation to a product vault', () => {
		for (const cmd of ['prepareKeyRotation', 'commitKeyRotation', 'abandonKeyRotation', 'sealProductFork'] as const) {
			expect(commandVaultModes[cmd], `${cmd} must stay in the account vault`).toEqual(['account']);
		}
		for (const cmd of [...keyIssuingCommands, 'reformatKeyWithUids', 'commitReformattedKey'] as const) {
			expect(commandVaultModes[cmd], `${cmd} must not reach a calendar vault`).not.toContain('calendar');
			if (cmd === 'reformatKeyWithUids' || cmd === 'commitReformattedKey') {
				expect(commandVaultModes[cmd], `${cmd} must not reach a mail vault`).not.toContain('mail');
			}
		}
	});

	it('lets a mail vault read its keyring and issue alias and delegation keys, never rewrite its own', () => {
		for (const cmd of ['loadAccountKeys', 'listAccountKeys', 'loadAliasKeys', 'unloadAliasKeys', 'createAliasKey', 'createSigningDelegationKey'] as const) {
			expect(commandVaultModes[cmd]).toEqual(['account', 'mail']);
		}
	});

	it('allows a product vault the crypto it needs', () => {
		for (const cmd of ['decrypt', 'encrypt', 'encryptToKeys', 'signDetached', 'attachmentHeader', 'attachmentBytes', 'getPublicKey', 'sealIndex', 'openIndex'] as const) {
			expect(commandVaultModes[cmd]).toEqual(['account', 'mail', 'calendar']);
		}
	});

	it('keeps typed calendar signatures and calendar keys in calendar vaults alone', () => {
		for (const cmd of ['signInvitation', 'signReply', 'signFreeBusy', 'signCalendarGrant', 'createCalendarKey', 'loadCalendarKeys'] as const) {
			expect(commandVaultModes[cmd]).toEqual(['calendar']);
		}
	});

	it.each(['openSearchRoot', 'sealSearchArtifact', 'openSearchArtifact', 'deriveSearchDbKey', 'closeSearchSession'] as const)(
		'keeps %s in the mail vault alone, out of the calendar and auth workers',
		(cmd) => {
			expect(commandVaultModes[cmd]).toEqual(['mail']);
			expect(commandVaultModes[cmd]).not.toContain('auth');
			expect(commandVaultModes[cmd]).not.toContain('calendar');
			expect(commandVaultModes[cmd]).not.toContain('account');
		}
	);

	it('lets both product vaults adopt a handoff and no account vault', () => {
		for (const cmd of ['adoptHandoff', 'commitHandoff', 'discardHandoff'] as const) {
			expect(commandVaultModes[cmd]).toEqual(['mail', 'calendar']);
		}
	});

	it('allows a product vault to lock and persist itself', () => {
		for (const cmd of ['status', 'lock', 'clear', 'enrollPersistent', 'tryRestoreFromPersistent'] as const) {
			expect(commandVaultModes[cmd]).toEqual(['account', 'mail', 'calendar', 'auth']);
		}
	});

	it('leaves dropping a remembered vault to the auth origin', () => {
		expect(commandVaultModes.disablePersistent).toEqual(['auth']);
	});
});

describe('vault mode selection', () => {
	it('treats the mail app as an account vault, not a product vault', async () => {
		const { currentProduct, isProductVault } = await import('../products');
		expect(currentProduct).toBe('app');
		expect(isProductVault).toBe(false);
	});
});
