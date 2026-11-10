/// <reference lib="webworker" />

import type {
	AttachmentBytesArgs,
	AttachmentHeaderArgs,
	ClearArgs,
	CommitPasswordChangeArgs,
	CompleteLoginUnlockArgs,
	CompleteRecoveryUnlockArgs,
	DecryptArgs,
	LoadAliasKeysArgs,
	UnloadAliasKeysArgs,
	CreateAliasKeyArgs,
	CreateSigningDelegationKeyArgs,
	EncryptArgs,
	EncryptToKeysArgs,
	SignDetachedArgs,
	SealIndexArgs,
	OpenIndexArgs,
	EnrollPersistentArgs,
	GetPublicKeyArgs,
	ReformatKeyWithUidsArgs,
	CommitReformattedKeyArgs,
	InvalidatePersistedVaultArgs,
	LockArgs,
	MigrationFinishStageArgs,
	MigrationFinalizedArgs,
	MigrationStartRegistrationArgs,
	OpaqueAbandonOperationArgs,
	OpaqueCompleteLoginUnlockArgs,
	OpaqueCompleteRecoveryUnlockArgs,
	OpaqueFinalizeRegisterArgs,
	OpaqueFinishAmkRotationArgs,
	OpaquePrepareAmkRotationArgs,
	OpaqueFinishAuthArgs,
	OpaqueFinishCredentialResetArgs,
	OpaqueFinishRegistrationArgs,
	OpaquePasswordChangeCommitArgs,
	OpaquePasswordChangeFinishArgs,
	OpaquePasswordChangeStartArgs,
	OpaquePrepareCredentialResetArgs,
	OpaqueRecoverySetupFinishArgs,
	OpaqueRecoverySetupStartArgs,
	OpaqueStartAuthArgs,
	OpaqueStartRegistrationArgs,
	PrepareCredentialResetArgs,
	PrepareDeletionProofArgs,
	PrepareLoginArgs,
	PreparePasswordChangeCredentialsArgs,
	PreparePasswordChangeProofArgs,
	PrepareRecoveryLoginArgs,
	PrepareRecoverySetupArgs,
	TryRestoreFromPersistentArgs,
	VerifyLoginProofArgs,
	VerifyPasswordChangeProofArgs,
	VerifyRecoveryProofArgs,
	SealProductForkArgs,
	OpenProductForkArgs,
	AbandonKeyRotationArgs,
	CommitKeyRotationArgs,
	ListAccountKeysArgs,
	LoadAccountKeysArgs,
	PrepareKeyRotationArgs,
	CustodyAdoptArgs,
	CustodyCommitArgs,
	CustodyPrepareArgs,
	CustodyRetireArgs,
	CustodyScopedArgs,
	CustodyStageArgs
} from './protocol';
import { commandAllowed } from './worker/gate';
import {
	forgetPendingCustody,
	handleCustodyAdopt,
	handleCustodyCommit,
	handleCustodyDiscard,
	handleCustodyPrepare,
	handleCustodyRetire,
	handleCustodyStage
} from './worker/custody-ops';
import { ports, handleStatus, handleClear, handleClearAll, handleLock } from './worker/state';
import {
	handlePrepareLogin,
	handleVerifyLoginProof,
	handleAbandonLogin,
	handleCompleteLoginUnlock,
	handlePrepareRecoverySetup,
	handlePrepareRecoveryLogin,
	handleVerifyRecoveryProof,
	handleCompleteRecoveryUnlock,
	handlePrepareCredentialReset,
	handleDiscardRecovery,
	handlePrepareDeletionProof,
	handlePreparePasswordChangeProof,
	handleVerifyPasswordChangeProof,
	handlePreparePasswordChangeCredentials,
	handleCommitPasswordChange,
	handleAbandonPasswordChange,
	handleMigrationStartRegistration,
	handleMigrationFinishStage,
	handleMigrationFinalized
} from './worker/srp-ops';
import {
	handleInvalidatePersistedVault,
	handleEnrollPersistent,
	handleTryRestoreFromPersistent
} from './worker/vault-persist';
import {
	handleSealIndex,
	handleOpenIndex,
	handleGetPublicKey,
	handleEncrypt,
	handleSignDetached,
	handleEncryptToKeys,
	handleDecrypt,
	handleAttachmentHeader,
	handleAttachmentBytes
} from './worker/content-ops';
import {
	handleLoadAliasKeys,
	handleUnloadAliasKeys,
	handleCreateAliasKey,
	handleCreateSigningDelegationKey,
	handleLoadAccountKeys,
	handleListAccountKeys,
	handlePrepareKeyRotation,
	handleCommitKeyRotation,
	handleAbandonKeyRotation
} from './worker/key-ops';
import { handleCommitReformattedKey, handleReformatKeyWithUids } from './worker/uid-ops';
import {
	handleOpaqueAbandonOperation,
	handleOpaqueStartRegistration,
	handleOpaqueFinishRegistration,
	handleOpaqueFinalizeRegister,
	handleOpaqueStartAuth,
	handleOpaqueFinishAuth,
	handleOpaqueCompleteLoginUnlock,
	handleOpaqueRecoverySetupStart,
	handleOpaqueRecoverySetupFinish,
	handleOpaqueCompleteRecoveryUnlock,
	handleOpaquePrepareCredentialReset,
	handleOpaqueFinishCredentialReset,
	handleOpaquePrepareAmkRotation,
	handleOpaqueFinishAmkRotation,
	handleOpaquePasswordChangeStart,
	handleOpaquePasswordChangeFinish,
	handleOpaquePasswordChangeCommit
} from './worker/opaque-account';
import type { RequestMessage } from './worker/serve';
import { respond, respondError } from './worker/serve';
import { handleSealProductFork, handleOpenProductFork } from './worker/fork-ops';
import { handleAdoptHandoff, handleCommitHandoff, handleDiscardHandoff } from './worker/handoff-ops';
import type {
	AdoptHandoffArgs,
	CommitHandoffArgs,
	CreateCalendarKeyArgs,
	LoadCalendarKeysArgs,
	SignCalendarGrantArgs,
	SignFreeBusyArgs,
	SignInvitationArgs,
	SignReplyArgs
} from './protocol';
import {
	handleCreateCalendarKey,
	handleLoadCalendarKeys,
	handleSignCalendarGrant,
	handleSignFreeBusy,
	handleSignInvitation,
	handleSignReply
} from './worker/calendar-ops';

declare const self: SharedWorkerGlobalScope;

async function dispatch(port: MessagePort, msg: RequestMessage) {
	try {
		if (!commandAllowed(msg.cmd, msg.args)) {
			respondError(port, msg.id, new Error('command unavailable'));
			return;
		}
		switch (msg.cmd) {
			case 'status':
				respond(port, msg.id, await handleStatus());
				break;
			case 'prepareLogin':
				respond(port, msg.id, await handlePrepareLogin(msg.args as PrepareLoginArgs));
				break;
			case 'verifyLoginProof':
				respond(port, msg.id, handleVerifyLoginProof(msg.args as VerifyLoginProofArgs));
				break;
			case 'completeLoginUnlock':
				respond(port, msg.id, await handleCompleteLoginUnlock(msg.args as CompleteLoginUnlockArgs));
				break;
			case 'abandonLogin':
				handleAbandonLogin();
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
				respond(port, msg.id, await handleOpaqueFinishAuth(msg.args as OpaqueFinishAuthArgs));
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
			case 'migrationStartRegistration':
				respond(
					port,
					msg.id,
					await handleMigrationStartRegistration(msg.args as MigrationStartRegistrationArgs)
				);
				break;
			case 'migrationFinishStage':
				respond(
					port,
					msg.id,
					await handleMigrationFinishStage(msg.args as MigrationFinishStageArgs)
				);
				break;
			case 'migrationFinalized':
				respond(port, msg.id, await handleMigrationFinalized(msg.args as MigrationFinalizedArgs));
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
			case 'prepareRecoverySetup':
				respond(
					port,
					msg.id,
					await handlePrepareRecoverySetup(msg.args as PrepareRecoverySetupArgs)
				);
				break;
			case 'prepareRecoveryLogin':
				respond(
					port,
					msg.id,
					await handlePrepareRecoveryLogin(msg.args as PrepareRecoveryLoginArgs)
				);
				break;
			case 'verifyRecoveryProof':
				respond(port, msg.id, handleVerifyRecoveryProof(msg.args as VerifyRecoveryProofArgs));
				break;
			case 'completeRecoveryUnlock':
				respond(
					port,
					msg.id,
					await handleCompleteRecoveryUnlock(msg.args as CompleteRecoveryUnlockArgs)
				);
				break;
			case 'prepareCredentialReset':
				respond(
					port,
					msg.id,
					await handlePrepareCredentialReset(msg.args as PrepareCredentialResetArgs)
				);
				break;
			case 'discardRecovery':
				handleDiscardRecovery();
				respond(port, msg.id, undefined);
				break;
			case 'prepareDeletionProof':
				respond(
					port,
					msg.id,
					await handlePrepareDeletionProof(msg.args as PrepareDeletionProofArgs)
				);
				break;
			case 'preparePasswordChangeProof':
				respond(
					port,
					msg.id,
					await handlePreparePasswordChangeProof(msg.args as PreparePasswordChangeProofArgs)
				);
				break;
			case 'verifyPasswordChangeProof':
				respond(
					port,
					msg.id,
					handleVerifyPasswordChangeProof(msg.args as VerifyPasswordChangeProofArgs)
				);
				break;
			case 'preparePasswordChangeCredentials':
				respond(
					port,
					msg.id,
					await handlePreparePasswordChangeCredentials(
						msg.args as PreparePasswordChangeCredentialsArgs
					)
				);
				break;
			case 'commitPasswordChange':
				respond(
					port,
					msg.id,
					await handleCommitPasswordChange(msg.args as CommitPasswordChangeArgs)
				);
				break;
			case 'invalidatePersistedVault':
				await handleInvalidatePersistedVault(msg.args as InvalidatePersistedVaultArgs);
				respond(port, msg.id, undefined);
				break;
			case 'abandonPasswordChange':
				handleAbandonPasswordChange();
				respond(port, msg.id, undefined);
				break;
			case 'lock':
				forgetPendingCustody((msg.args as LockArgs).accountId);
				handleLock(msg.args as LockArgs);
				respond(port, msg.id, undefined);
				break;
			case 'clear':
				forgetPendingCustody((msg.args as ClearArgs).accountId);
				await handleClear(msg.args as ClearArgs);
				respond(port, msg.id, undefined);
				break;
			case 'clearAll':
				forgetPendingCustody();
				await handleClearAll();
				respond(port, msg.id, undefined);
				break;
			case 'enrollPersistent':
				respond(port, msg.id, await handleEnrollPersistent(msg.args as EnrollPersistentArgs));
				break;
			case 'tryRestoreFromPersistent':
				respond(
					port,
					msg.id,
					await handleTryRestoreFromPersistent(msg.args as TryRestoreFromPersistentArgs)
				);
				break;
			case 'attachmentHeader':
				respond(port, msg.id, await handleAttachmentHeader(msg.args as AttachmentHeaderArgs));
				break;
			case 'attachmentBytes':
				respond(port, msg.id, await handleAttachmentBytes(msg.args as AttachmentBytesArgs));
				break;
			case 'decrypt':
				respond(port, msg.id, await handleDecrypt(msg.args as DecryptArgs));
				break;
			case 'loadAliasKeys':
				respond(port, msg.id, await handleLoadAliasKeys(msg.args as LoadAliasKeysArgs));
				break;
			case 'unloadAliasKeys':
				handleUnloadAliasKeys(msg.args as UnloadAliasKeysArgs);
				respond(port, msg.id, undefined);
				break;
			case 'createAliasKey':
				respond(port, msg.id, await handleCreateAliasKey(msg.args as CreateAliasKeyArgs));
				break;
			case 'createSigningDelegationKey':
				respond(
					port,
					msg.id,
					await handleCreateSigningDelegationKey(msg.args as CreateSigningDelegationKeyArgs)
				);
				break;
			case 'getPublicKey':
				respond(port, msg.id, await handleGetPublicKey(msg.args as GetPublicKeyArgs));
				break;
			case 'loadAccountKeys':
				respond(port, msg.id, await handleLoadAccountKeys(msg.args as LoadAccountKeysArgs));
				break;
			case 'listAccountKeys':
				respond(port, msg.id, handleListAccountKeys(msg.args as ListAccountKeysArgs));
				break;
			case 'prepareKeyRotation':
				respond(port, msg.id, await handlePrepareKeyRotation(msg.args as PrepareKeyRotationArgs));
				break;
			case 'commitKeyRotation':
				respond(port, msg.id, await handleCommitKeyRotation(msg.args as CommitKeyRotationArgs));
				break;
			case 'abandonKeyRotation':
				handleAbandonKeyRotation(msg.args as AbandonKeyRotationArgs);
				respond(port, msg.id, undefined);
				break;
			case 'reformatKeyWithUids':
				respond(
					port,
					msg.id,
					await handleReformatKeyWithUids(msg.args as ReformatKeyWithUidsArgs)
				);
				break;
			case 'commitReformattedKey':
				respond(
					port,
					msg.id,
					await handleCommitReformattedKey(msg.args as CommitReformattedKeyArgs)
				);
				break;
			case 'encrypt':
				respond(port, msg.id, await handleEncrypt(msg.args as EncryptArgs));
				break;
			case 'encryptToKeys':
				respond(port, msg.id, await handleEncryptToKeys(msg.args as EncryptToKeysArgs));
				break;
			case 'signInvitation':
				respond(port, msg.id, await handleSignInvitation(msg.args as SignInvitationArgs));
				break;
			case 'signReply':
				respond(port, msg.id, await handleSignReply(msg.args as SignReplyArgs));
				break;
			case 'signFreeBusy':
				respond(port, msg.id, await handleSignFreeBusy(msg.args as SignFreeBusyArgs));
				break;
			case 'signCalendarGrant':
				respond(port, msg.id, await handleSignCalendarGrant(msg.args as SignCalendarGrantArgs));
				break;
			case 'createCalendarKey':
				respond(port, msg.id, await handleCreateCalendarKey(msg.args as CreateCalendarKeyArgs));
				break;
			case 'loadCalendarKeys':
				respond(port, msg.id, await handleLoadCalendarKeys(msg.args as LoadCalendarKeysArgs));
				break;
			case 'signDetached':
				respond(port, msg.id, await handleSignDetached(msg.args as SignDetachedArgs));
				break;
			case 'sealIndex':
				respond(port, msg.id, await handleSealIndex(msg.args as SealIndexArgs));
				break;
			case 'sealProductFork':
				respond(port, msg.id, await handleSealProductFork(msg.args as SealProductForkArgs));
				break;
			case 'adoptHandoff':
				respond(port, msg.id, await handleAdoptHandoff(msg.args as AdoptHandoffArgs));
				break;
			case 'commitHandoff':
				respond(port, msg.id, await handleCommitHandoff(msg.args as CommitHandoffArgs));
				break;
			case 'discardHandoff':
				respond(port, msg.id, await handleDiscardHandoff(msg.args as CommitHandoffArgs));
				break;
			case 'openProductFork':
				respond(port, msg.id, await handleOpenProductFork(msg.args as OpenProductForkArgs));
				break;
			case 'openIndex':
				respond(port, msg.id, await handleOpenIndex(msg.args as OpenIndexArgs));
				break;
			case 'custodyPrepare':
				respond(port, msg.id, await handleCustodyPrepare(msg.args as CustodyPrepareArgs));
				break;
			case 'custodyAdopt':
				respond(port, msg.id, await handleCustodyAdopt(msg.args as CustodyAdoptArgs));
				break;
			case 'custodyStage':
				respond(port, msg.id, await handleCustodyStage(msg.args as CustodyStageArgs));
				break;
			case 'custodyCommit':
				respond(port, msg.id, await handleCustodyCommit(msg.args as CustodyCommitArgs));
				break;
			case 'custodyRetire':
				respond(port, msg.id, await handleCustodyRetire(msg.args as CustodyRetireArgs));
				break;
			case 'custodyDiscard':
				respond(port, msg.id, await handleCustodyDiscard(msg.args as CustodyScopedArgs));
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
