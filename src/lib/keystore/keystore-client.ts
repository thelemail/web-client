import { browser } from '$app/environment';
import type {
	Broadcast,
	ClearArgs,
	DecryptArgs,
	DecryptResponse,
	CompleteLoginUnlockArgs,
	CompleteLoginUnlockResponse,
	CompleteRecoveryUnlockArgs,
	CompleteRecoveryUnlockResponse,
	DisablePersistentArgs,
	EncryptArgs,
	EncryptResponse,
	EncryptToKeysArgs,
	EncryptToKeysResponse,
	EnrollPersistentArgs,
	GetPublicKeyArgs,
	GetPublicKeyResponse,
	ReformatKeyWithUidsArgs,
	ReformatKeyWithUidsResponse,
	CommitReformattedKeyArgs,
	CommitReformattedKeyResponse,
	LockArgs,
	CommitPasswordChangeArgs,
	CommitPasswordChangeResponse,
	InvalidatePersistedVaultArgs,
	MigrationFinishStageArgs,
	MigrationFinishStageResponse,
	MigrationStartRegistrationArgs,
	MigrationStartRegistrationResponse,
	OpaqueAbandonOperationArgs,
	OpaqueCompleteLoginUnlockArgs,
	OpaqueCompleteLoginUnlockResponse,
	OpaqueCompleteRecoveryUnlockArgs,
	OpaqueCompleteRecoveryUnlockResponse,
	OpaqueFinalizeRegisterArgs,
	OpaqueFinalizeRegisterResponse,
	OpaqueFinishAmkRotationArgs,
	OpaquePrepareAmkRotationArgs,
	OpaquePrepareAmkRotationResponse,
	OpaqueFinishAmkRotationResponse,
	OpaqueFinishAuthArgs,
	OpaqueFinishAuthResponse,
	OpaqueFinishCredentialResetArgs,
	OpaqueFinishCredentialResetResponse,
	OpaqueFinishRegistrationArgs,
	OpaqueFinishRegistrationResponse,
	OpaquePasswordChangeCommitArgs,
	OpaquePasswordChangeCommitResponse,
	OpaquePasswordChangeFinishArgs,
	OpaquePasswordChangeFinishResponse,
	OpaquePasswordChangeStartArgs,
	OpaquePasswordChangeStartResponse,
	OpaquePrepareCredentialResetArgs,
	OpaquePrepareCredentialResetResponse,
	OpaqueRecoverySetupFinishArgs,
	OpaqueRecoverySetupFinishResponse,
	OpaqueRecoverySetupStartArgs,
	OpaqueRecoverySetupStartResponse,
	OpaqueStartAuthArgs,
	OpaqueStartAuthResponse,
	OpaqueStartRegistrationArgs,
	OpaqueStartRegistrationResponse,
	PrepareCredentialResetArgs,
	PrepareCredentialResetResponse,
	PrepareDeletionProofArgs,
	PrepareDeletionProofResponse,
	PrepareLoginArgs,
	PrepareLoginResponse,
	PreparePasswordChangeCredentialsArgs,
	PreparePasswordChangeCredentialsResponse,
	PreparePasswordChangeProofArgs,
	PreparePasswordChangeProofResponse,
	PrepareRecoveryLoginArgs,
	PrepareRecoveryLoginResponse,
	PrepareRecoverySetupArgs,
	PrepareRecoverySetupResponse,
	RestoreResponse,
	StatusResponse,
	TryRestoreFromPersistentArgs,
	VerifyLoginProofArgs,
	VerifyLoginProofResponse,
	VerifyPasswordChangeProofArgs,
	VerifyPasswordChangeProofResponse,
	VerifyRecoveryProofArgs,
	VerifyRecoveryProofResponse
} from './protocol';

const KEYSTORE_SINGLETON = Symbol.for('thelemail.keystore.singleton');

interface PendingRequest {
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
}

interface KeystoreSingleton {
	port: MessagePort;
	pending: Map<string, PendingRequest>;
	listeners: Set<(b: Broadcast) => void>;
}

interface GlobalShape {
	[KEYSTORE_SINGLETON]?: KeystoreSingleton;
}

function getSingleton(): KeystoreSingleton {
	if (!browser) {
		throw new Error('keystore-client used outside the browser');
	}
	const g = globalThis as GlobalShape;
	if (g[KEYSTORE_SINGLETON]) return g[KEYSTORE_SINGLETON];

	const worker = new SharedWorker(new URL('./keystore-worker.ts', import.meta.url), {
		type: 'module',
		name: 'thelemail-keystore'
	});
	const port = worker.port;
	const pending = new Map<string, PendingRequest>();
	const listeners = new Set<(b: Broadcast) => void>();

	port.onmessage = (ev: MessageEvent) => {
		const data = ev.data;
		if (!data || typeof data !== 'object') return;
		if (data.type === 'response') {
			const p = pending.get(data.id);
			if (!p) return;
			pending.delete(data.id);
			if (data.error) {
				p.reject(new Error(data.error));
			} else {
				p.resolve(data.value);
			}
		} else if (
			data.type === 'vaultChanged' ||
			data.type === 'locked' ||
			data.type === 'cleared' ||
			data.type === 'clearedAll' ||
			data.type === 'persistentDisabled'
		) {
			for (const cb of listeners) cb(data as Broadcast);
		}
	};
	port.start();

	const singleton: KeystoreSingleton = { port, pending, listeners };
	g[KEYSTORE_SINGLETON] = singleton;
	return singleton;
}

function call<T>(cmd: string, args?: unknown): Promise<T> {
	const s = getSingleton();
	const id = crypto.randomUUID();
	return new Promise<T>((resolve, reject) => {
		s.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
		s.port.postMessage({ id, cmd, args });
	});
}

function broadcastAccountId(b: Broadcast): string | null {
	switch (b.type) {
		case 'vaultChanged':
		case 'locked':
		case 'cleared':
		case 'persistentDisabled':
			return b.accountId;
		case 'clearedAll':
			return null;
	}
}

export const keystore = {
	status: () => call<StatusResponse>('status'),
	prepareLogin: (args: PrepareLoginArgs) => call<PrepareLoginResponse>('prepareLogin', args),
	verifyLoginProof: (args: VerifyLoginProofArgs) =>
		call<VerifyLoginProofResponse>('verifyLoginProof', args),
	completeLoginUnlock: (args: CompleteLoginUnlockArgs) =>
		call<CompleteLoginUnlockResponse>('completeLoginUnlock', args),
	abandonLogin: () => call<void>('abandonLogin'),
	opaqueStartRegistration: (args: OpaqueStartRegistrationArgs) =>
		call<OpaqueStartRegistrationResponse>('opaqueStartRegistration', args),
	opaqueFinishRegistration: (args: OpaqueFinishRegistrationArgs) =>
		call<OpaqueFinishRegistrationResponse>('opaqueFinishRegistration', args),
	opaqueFinalizeRegister: (args: OpaqueFinalizeRegisterArgs) =>
		call<OpaqueFinalizeRegisterResponse>('opaqueFinalizeRegister', args),
	opaqueStartAuth: (args: OpaqueStartAuthArgs) => call<OpaqueStartAuthResponse>('opaqueStartAuth', args),
	opaqueFinishAuth: (args: OpaqueFinishAuthArgs) =>
		call<OpaqueFinishAuthResponse>('opaqueFinishAuth', args),
	opaqueCompleteLoginUnlock: (args: OpaqueCompleteLoginUnlockArgs) =>
		call<OpaqueCompleteLoginUnlockResponse>('opaqueCompleteLoginUnlock', args),
	opaqueAbandonOperation: (args: OpaqueAbandonOperationArgs) =>
		call<void>('opaqueAbandonOperation', args),
	migrationStartRegistration: (args: MigrationStartRegistrationArgs) =>
		call<MigrationStartRegistrationResponse>('migrationStartRegistration', args),
	migrationFinishStage: (args: MigrationFinishStageArgs) =>
		call<MigrationFinishStageResponse>('migrationFinishStage', args),
	opaqueRecoverySetupStart: (args: OpaqueRecoverySetupStartArgs) =>
		call<OpaqueRecoverySetupStartResponse>('opaqueRecoverySetupStart', args),
	opaqueRecoverySetupFinish: (args: OpaqueRecoverySetupFinishArgs) =>
		call<OpaqueRecoverySetupFinishResponse>('opaqueRecoverySetupFinish', args),
	opaqueCompleteRecoveryUnlock: (args: OpaqueCompleteRecoveryUnlockArgs) =>
		call<OpaqueCompleteRecoveryUnlockResponse>('opaqueCompleteRecoveryUnlock', args),
	opaquePrepareCredentialReset: (args: OpaquePrepareCredentialResetArgs) =>
		call<OpaquePrepareCredentialResetResponse>('opaquePrepareCredentialReset', args),
	opaqueFinishCredentialReset: (args: OpaqueFinishCredentialResetArgs) =>
		call<OpaqueFinishCredentialResetResponse>('opaqueFinishCredentialReset', args),
	opaquePrepareAmkRotation: (args: OpaquePrepareAmkRotationArgs) =>
		call<OpaquePrepareAmkRotationResponse>('opaquePrepareAmkRotation', args),
	opaqueFinishAmkRotation: (args: OpaqueFinishAmkRotationArgs) =>
		call<OpaqueFinishAmkRotationResponse>('opaqueFinishAmkRotation', args),
	opaquePasswordChangeStart: (args: OpaquePasswordChangeStartArgs) =>
		call<OpaquePasswordChangeStartResponse>('opaquePasswordChangeStart', args),
	opaquePasswordChangeFinish: (args: OpaquePasswordChangeFinishArgs) =>
		call<OpaquePasswordChangeFinishResponse>('opaquePasswordChangeFinish', args),
	opaquePasswordChangeCommit: (args: OpaquePasswordChangeCommitArgs) =>
		call<OpaquePasswordChangeCommitResponse>('opaquePasswordChangeCommit', args),
	prepareRecoverySetup: (args: PrepareRecoverySetupArgs) =>
		call<PrepareRecoverySetupResponse>('prepareRecoverySetup', args),
	prepareRecoveryLogin: (args: PrepareRecoveryLoginArgs) =>
		call<PrepareRecoveryLoginResponse>('prepareRecoveryLogin', args),
	verifyRecoveryProof: (args: VerifyRecoveryProofArgs) =>
		call<VerifyRecoveryProofResponse>('verifyRecoveryProof', args),
	completeRecoveryUnlock: (args: CompleteRecoveryUnlockArgs) =>
		call<CompleteRecoveryUnlockResponse>('completeRecoveryUnlock', args),
	prepareCredentialReset: (args: PrepareCredentialResetArgs) =>
		call<PrepareCredentialResetResponse>('prepareCredentialReset', args),
	discardRecovery: () => call<void>('discardRecovery'),
	preparePasswordChangeProof: (args: PreparePasswordChangeProofArgs) =>
		call<PreparePasswordChangeProofResponse>('preparePasswordChangeProof', args),
	prepareDeletionProof: (args: PrepareDeletionProofArgs) =>
		call<PrepareDeletionProofResponse>('prepareDeletionProof', args),
	verifyPasswordChangeProof: (args: VerifyPasswordChangeProofArgs) =>
		call<VerifyPasswordChangeProofResponse>('verifyPasswordChangeProof', args),
	preparePasswordChangeCredentials: (args: PreparePasswordChangeCredentialsArgs) =>
		call<PreparePasswordChangeCredentialsResponse>('preparePasswordChangeCredentials', args),
	commitPasswordChange: (args: CommitPasswordChangeArgs) =>
		call<CommitPasswordChangeResponse>('commitPasswordChange', args),
	invalidatePersistedVault: (args: InvalidatePersistedVaultArgs) =>
		call<void>('invalidatePersistedVault', args),
	abandonPasswordChange: () => call<void>('abandonPasswordChange'),
	lock: (args: LockArgs) => call<void>('lock', args),
	clear: (args: ClearArgs) => call<void>('clear', args),
	clearAll: () => call<void>('clearAll'),
	enrollPersistent: (args: EnrollPersistentArgs) => call<void>('enrollPersistent', args),
	tryRestoreFromPersistent: (args: TryRestoreFromPersistentArgs) =>
		call<RestoreResponse>('tryRestoreFromPersistent', args),
	disablePersistent: (args: DisablePersistentArgs) => call<void>('disablePersistent', args),
	decrypt: (args: DecryptArgs) => call<DecryptResponse>('decrypt', args),
	getPublicKey: (args: GetPublicKeyArgs) => call<GetPublicKeyResponse>('getPublicKey', args),
	reformatKeyWithUids: (args: ReformatKeyWithUidsArgs) =>
		call<ReformatKeyWithUidsResponse>('reformatKeyWithUids', args),
	commitReformattedKey: (args: CommitReformattedKeyArgs) =>
		call<CommitReformattedKeyResponse>('commitReformattedKey', args),
	encrypt: (args: EncryptArgs) => call<EncryptResponse>('encrypt', args),
	encryptToKeys: (args: EncryptToKeysArgs) => call<EncryptToKeysResponse>('encryptToKeys', args),
	subscribe(cb: (b: Broadcast) => void): () => void {
		const s = getSingleton();
		s.listeners.add(cb);
		return () => s.listeners.delete(cb);
	},
	subscribeAccount(accountId: string, cb: (b: Broadcast) => void): () => void {
		const wrapped = (b: Broadcast) => {
			const id = broadcastAccountId(b);
			if (id === null || id === accountId) cb(b);
		};
		const s = getSingleton();
		s.listeners.add(wrapped);
		return () => s.listeners.delete(wrapped);
	}
};
