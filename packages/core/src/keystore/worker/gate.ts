/// <reference lib="webworker" />

import { isProductVault } from '../../products';
import type { KeystoreCommand, VaultMode } from '../protocol';
import { commandVaultModes } from '../protocol';
import { productAccounts, vaults } from './state';

const BUILD_MODES: readonly VaultMode[] = isProductVault ? ['calendar'] : ['account', 'mail'];

function accountIdOf(args: unknown): string | null {
	if (!args || typeof args !== 'object') return null;
	const id = (args as { accountId?: unknown }).accountId;
	return typeof id === 'string' && id !== '' ? id : null;
}

export function vaultModeOf(accountId: string): VaultMode | null {
	if (isProductVault) return 'calendar';
	const v = vaults.get(accountId);
	if (v) return v.product === 'app' ? 'mail' : 'account';
	return productAccounts.has(accountId) ? 'mail' : null;
}

export function commandAllowed(cmd: KeystoreCommand, args: unknown): boolean {
	const modes = commandVaultModes[cmd];
	if (modes === undefined || !modes.some((m) => BUILD_MODES.includes(m))) return false;
	const accountId = accountIdOf(args);
	if (!accountId) return true;
	const mode = vaultModeOf(accountId);
	return mode === null || modes.includes(mode);
}
