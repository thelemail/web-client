/// <reference lib="webworker" />

import type {
	ClearArgs,
	DisablePersistentArgs,
	EnrollPersistentArgs,
	InvalidatePersistedVaultArgs,
	KeystoreCommand,
	LockArgs,
	OpaqueAbandonOperationArgs,
	OpaqueCompleteLoginUnlockArgs,
	OpaqueCompleteRecoveryUnlockArgs,
	OpaqueFinalizeRegisterArgs,
	OpaqueFinishAmkRotationArgs,
	OpaqueFinishAuthArgs,
	OpaqueFinishCredentialResetArgs,
	OpaqueFinishRegistrationArgs,
	OpaquePasswordChangeCommitArgs,
	OpaquePasswordChangeFinishArgs,
	OpaquePasswordChangeStartArgs,
	OpaquePrepareAmkRotationArgs,
	OpaquePrepareCredentialResetArgs,
	OpaqueRecoverySetupFinishArgs,
	OpaqueRecoverySetupStartArgs,
	OpaqueStartAuthArgs,
	OpaqueStartRegistrationArgs,
	CommitReformattedKeyArgs,
	PrepareProductKeysArgs,
	ReadProductKeysArgs,
	ReformatKeyWithUidsArgs,
	SealProductHandoffArgs,
	TryRestoreFromPersistentArgs
} from './protocol';
import { commandVaultModes } from './protocol';
import {
	handleClear,
	handleClearAll,
	handleLock,
	handleStatus,
	opaqueOps,
	pendingFlows,
	ports,
	vaults
} from './worker/state';
import {
	handleOpaqueAbandonOperation,
	handleOpaqueCompleteLoginUnlock,
	handleOpaqueCompleteRecoveryUnlock,
	handleOpaqueFinalizeRegister,
	handleOpaqueFinishAmkRotation,
	handleOpaqueFinishAuth,
	handleOpaqueFinishCredentialReset,
	handleOpaqueFinishRegistration,
	handleOpaquePasswordChangeCommit,
	handleOpaquePasswordChangeFinish,
	handleOpaquePasswordChangeStart,
	handleOpaquePrepareAmkRotation,
	handleOpaquePrepareCredentialReset,
	handleOpaqueRecoverySetupFinish,
	handleOpaqueRecoverySetupStart,
	handleOpaqueStartAuth,
	handleOpaqueStartRegistration
} from './worker/opaque-account';
import {
	handleDisablePersistent,
	handleEnrollPersistent,
	handleInvalidatePersistedVault,
	handleTryRestoreFromPersistent
} from './worker/vault-persist';
import { handlePrepareProductKeys, handleReadProductKeys, handleSealProductHandoff } from './worker/product-keys';
import { handleCommitReformattedKey, handleReformatKeyWithUids } from './worker/uid-ops';
import type { RequestMessage } from './worker/serve';
import { respond, respondError } from './worker/serve';

declare const self: SharedWorkerGlobalScope;

export const AUTH_IDLE_MS = 15 * 60 * 1000;
const IDLE_SWEEP_MS = 30 * 1000;

let lastActivity = Date.now();

function commandAllowed(cmd: KeystoreCommand): boolean {
	return commandVaultModes[cmd]?.includes('auth') ?? false;
}

function idleClear(): void {
	opaqueOps.clear();
	pendingFlows.login = null;
	pendingFlows.recoveryLogin = null;
	pendingFlows.reset = null;
	pendingFlows.passwordChange = null;
	for (const accountId of [...vaults.keys()]) handleLock({ accountId });
}

setInterval(() => {
	if (Date.now() - lastActivity >= AUTH_IDLE_MS) idleClear();
}, IDLE_SWEEP_MS);

async function dispatch(port: MessagePort, msg: RequestMessage) {
	try {
		if (!commandAllowed(msg.cmd)) {
			respondError(port, msg.id, new Error('command unavailable'));
			return;
		}
		if (msg.cmd !== 'status') {
			if (Date.now() - lastActivity >= AUTH_IDLE_MS) idleClear();
			lastActivity = Date.now();
		}
		switch (msg.cmd) {
			case 'status':
				respond(port, msg.id, await handleStatus());
				break;
			case 'touch':
				respond(port, msg.id, undefined);
				break;
			case 'opaqueStartRegistration':
				respond(
					port,
					msg.id,
					await handleOpaqueStartRegistration(msg.args as OpaqueStartRegistrationArgs)
				);
				break;
			case 'opaqueFinishRegistration':
				respond(
					port,
					msg.id,
					await handleOpaqueFinishRegistration(msg.args as OpaqueFinishRegistrationArgs)
				);
				break;
			case 'opaqueFinalizeRegister':
				respond(
					port,
					msg.id,
					await handleOpaqueFinalizeRegister(msg.args as OpaqueFinalizeRegisterArgs)
				);
				break;
			case 'opaqueStartAuth':
				respond(port, msg.id, await handleOpaqueStartAuth(msg.args as OpaqueStartAuthArgs));
				break;
			case 'opaqueFinishAuth':
				respond(
					port,
					msg.id,
					await handleOpaqueFinishAuth(msg.args as OpaqueFinishAuthArgs)
				);
				break;
			case 'opaqueCompleteLoginUnlock':
				respond(
					port,
					msg.id,
					await handleOpaqueCompleteLoginUnlock(msg.args as OpaqueCompleteLoginUnlockArgs)
				);
				break;
			case 'opaqueAbandonOperation':
				handleOpaqueAbandonOperation(msg.args as OpaqueAbandonOperationArgs);
				respond(port, msg.id, undefined);
				break;
			case 'opaqueRecoverySetupStart':
				respond(
					port,
					msg.id,
					await handleOpaqueRecoverySetupStart(msg.args as OpaqueRecoverySetupStartArgs)
				);
				break;
			case 'opaqueRecoverySetupFinish':
				respond(
					port,
					msg.id,
					await handleOpaqueRecoverySetupFinish(msg.args as OpaqueRecoverySetupFinishArgs)
				);
				break;
			case 'opaqueCompleteRecoveryUnlock':
				respond(
					port,
					msg.id,
					await handleOpaqueCompleteRecoveryUnlock(msg.args as OpaqueCompleteRecoveryUnlockArgs)
				);
				break;
			case 'opaquePrepareCredentialReset':
				respond(
					port,
					msg.id,
					await handleOpaquePrepareCredentialReset(msg.args as OpaquePrepareCredentialResetArgs)
				);
				break;
			case 'opaqueFinishCredentialReset':
				respond(
					port,
					msg.id,
					await handleOpaqueFinishCredentialReset(msg.args as OpaqueFinishCredentialResetArgs)
				);
				break;
			case 'opaquePrepareAmkRotation':
				respond(
					port,
					msg.id,
					await handleOpaquePrepareAmkRotation(msg.args as OpaquePrepareAmkRotationArgs)
				);
				break;
			case 'opaqueFinishAmkRotation':
				respond(
					port,
					msg.id,
					await handleOpaqueFinishAmkRotation(msg.args as OpaqueFinishAmkRotationArgs)
				);
				break;
			case 'opaquePasswordChangeStart':
				respond(
					port,
					msg.id,
					await handleOpaquePasswordChangeStart(msg.args as OpaquePasswordChangeStartArgs)
				);
				break;
			case 'opaquePasswordChangeFinish':
				respond(
					port,
					msg.id,
					await handleOpaquePasswordChangeFinish(msg.args as OpaquePasswordChangeFinishArgs)
				);
				break;
			case 'opaquePasswordChangeCommit':
				respond(
					port,
					msg.id,
					await handleOpaquePasswordChangeCommit(msg.args as OpaquePasswordChangeCommitArgs)
				);
				break;
			case 'invalidatePersistedVault':
				respond(
					port,
					msg.id,
					await handleInvalidatePersistedVault(msg.args as InvalidatePersistedVaultArgs)
				);
				break;
			case 'lock':
				handleLock(msg.args as LockArgs);
				respond(port, msg.id, undefined);
				break;
			case 'clear':
				respond(port, msg.id, await handleClear(msg.args as ClearArgs));
				break;
			case 'clearAll':
				respond(port, msg.id, await handleClearAll());
				break;
			case 'enrollPersistent':
				respond(
					port,
					msg.id,
					await handleEnrollPersistent(msg.args as EnrollPersistentArgs)
				);
				break;
			case 'tryRestoreFromPersistent':
				respond(
					port,
					msg.id,
					await handleTryRestoreFromPersistent(msg.args as TryRestoreFromPersistentArgs)
				);
				break;
			case 'disablePersistent':
				respond(
					port,
					msg.id,
					await handleDisablePersistent(msg.args as DisablePersistentArgs)
				);
				break;
			case 'prepareProductKeys':
				respond(port, msg.id, await handlePrepareProductKeys(msg.args as PrepareProductKeysArgs));
				break;
			case 'readProductKeys':
				respond(port, msg.id, await handleReadProductKeys(msg.args as ReadProductKeysArgs));
				break;
			case 'sealProductHandoff':
				respond(port, msg.id, await handleSealProductHandoff(msg.args as SealProductHandoffArgs));
				break;
			case 'reformatKeyWithUids':
				respond(port, msg.id, await handleReformatKeyWithUids(msg.args as ReformatKeyWithUidsArgs));
				break;
			case 'commitReformattedKey':
				respond(port, msg.id, await handleCommitReformattedKey(msg.args as CommitReformattedKeyArgs));
				break;
			default:
				respondError(port, msg.id, `unknown command: ${msg.cmd}`);
		}
	} catch (err) {
		respondError(port, msg.id, err);
	}
}

self.onconnect = (event: MessageEvent) => {
	const port = event.ports[0];
	ports.add(port);
	port.onmessage = (ev: MessageEvent<RequestMessage>) => {
		void dispatch(port, ev.data);
	};
	port.start?.();
};
