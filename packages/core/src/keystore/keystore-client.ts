import { browser } from '$app/env';
import { platform } from '$platform';
import type { KeystoreChannel } from '$core/platform/types';
import { serverClockOffsetMs } from '$core/api/serverclock';
import type {
	AttachmentBytesArgs,
	AttachmentBytesResponse,
	AttachmentHeaderArgs,
	AttachmentHeaderResponse,
	Broadcast,
	ClearArgs,
	DecryptArgs,
	LoadAliasKeysArgs,
	LoadAliasKeysResponse,
	UnloadAliasKeysArgs,
	CreateAliasKeyArgs,
	CreateSigningDelegationKeyArgs,
	CreateSigningDelegationKeyResponse,
	CreateAliasKeyResponse,
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
	SignDetachedArgs,
	SignDetachedResponse,
	CalendarStatementResponse,
	CreateCalendarKeyArgs,
	CreateCalendarKeyResponse,
	LoadCalendarKeysArgs,
	LoadCalendarKeysResponse,
	SignCalendarGrantArgs,
	SignFreeBusyArgs,
	SignInvitationArgs,
	SignReplyArgs,
	SealIndexArgs,
	SealIndexResponse,
	OpenIndexArgs,
	SealProductForkArgs,
	SealProductForkResponse,
	OpenProductForkArgs,
	OpenProductForkResponse,
	OpenIndexResponse,
	EnrollPersistentArgs,
	GetPublicKeyArgs,
	GetPublicKeyResponse,
	AbandonKeyRotationArgs,
	CommitKeyRotationArgs,
	CommitKeyRotationResponse,
	ListAccountKeysArgs,
	ListAccountKeysResponse,
	LoadAccountKeysArgs,
	LoadAccountKeysResponse,
	PrepareKeyRotationArgs,
	PrepareKeyRotationResponse,
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
	MigrationFinalizedArgs,
	MigrationFinalizedResponse,
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
	VerifyRecoveryProofResponse,
	PrepareProductKeysArgs,
	PrepareProductKeysResponse,
	ReadProductKeysArgs,
	ReadProductKeysResponse,
	SealProductHandoffArgs,
	SealProductHandoffResponse,
	AdoptHandoffArgs,
	AdoptHandoffResponse,
	CommitHandoffArgs,
	CommitHandoffResponse
} from './protocol';
import { LOCAL_KEY_UNSTORABLE } from './vault-wrap';

const KEYSTORE_SINGLETON = Symbol.for('thelemail.keystore.singleton');

const persistentListeners = new Set<(b: Broadcast) => void>();

const DEFAULT_TIMEOUT_MS = 60_000;
const CRYPTO_TIMEOUT_MS = 180_000;
const ATTACHMENT_HEADER_TIMEOUT_MS = 30_000;
const ATTACHMENT_BYTES_TIMEOUT_MS = 180_000;

const WORKER_UNAVAILABLE = 'keystore worker unavailable';

interface PendingRequest {
	cmd: string;
	resolve: (v: unknown) => void;
	reject: (e: Error) => void;
	timer?: ReturnType<typeof setTimeout>;
}

interface KeystoreSingleton {
	port: MessagePort;
	pending: Map<string, PendingRequest>;
	listeners: Set<(b: Broadcast) => void>;
}

interface GlobalShape {
	[KEYSTORE_SINGLETON]?: KeystoreSingleton;
}

function settle(pending: Map<string, PendingRequest>, id: string): PendingRequest | undefined {
	const p = pending.get(id);
	if (!p) return undefined;
	pending.delete(id);
	if (p.timer !== undefined) clearTimeout(p.timer);
	return p;
}

function teardown(singleton: KeystoreSingleton, reason: string) {
	const g = globalThis as GlobalShape;
	if (g[KEYSTORE_SINGLETON] === singleton) delete g[KEYSTORE_SINGLETON];
	const entries = [...singleton.pending.keys()];
	for (const id of entries) settle(singleton.pending, id)?.reject(new Error(reason));
}

function getSingleton(): KeystoreSingleton {
	if (!browser) {
		throw new Error('keystore-client used outside the browser');
	}
	const g = globalThis as GlobalShape;
	if (g[KEYSTORE_SINGLETON]) return g[KEYSTORE_SINGLETON];

	let worker: SharedWorker;
	try {
		if (!platform.spawnKeystore) throw new Error(WORKER_UNAVAILABLE);
		worker = platform.spawnKeystore();
	} catch {
		throw new Error(WORKER_UNAVAILABLE);
	}
	const port = worker.port;
	const pending = new Map<string, PendingRequest>();
	const listeners = persistentListeners;

	port.onmessage = (ev: MessageEvent) => {
		const data = ev.data;
		if (!data || typeof data !== 'object') return;
		if (data.type === 'response') {
			const p = settle(pending, data.id);
			if (!p) return;
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
			data.type === 'persistentDisabled' ||
			data.type === 'aliasKeysChanged' ||
			data.type === 'accountKeysChanged'
		) {
			forgetDeviceKey(data as Broadcast);
			for (const cb of listeners) cb(data as Broadcast);
		}
	};
	port.start();

	const singleton: KeystoreSingleton = { port, pending, listeners };
	worker.onerror = () => teardown(singleton, WORKER_UNAVAILABLE);
	port.onmessageerror = () => teardown(singleton, WORKER_UNAVAILABLE);
	g[KEYSTORE_SINGLETON] = singleton;
	return singleton;
}

function call<T>(
	cmd: string,
	args?: unknown,
	timeoutMs?: number,
	transfer: Transferable[] = []
): Promise<T> {
	const deadline = timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const channel = platform.keystoreChannel as KeystoreChannel<Broadcast> | undefined;
	if (channel) {
		return channel.call<T>(cmd, args, deadline);
	}
	const s = getSingleton();
	const id = crypto.randomUUID();
	return new Promise<T>((resolve, reject) => {
		const entry: PendingRequest = { cmd, resolve: resolve as (v: unknown) => void, reject };
		entry.timer = setTimeout(() => {
			settle(s.pending, id)?.reject(new Error(`keystore ${cmd} timed out`));
		}, deadline);
		s.pending.set(id, entry);
		s.port.postMessage({ id, cmd, args }, transfer);
	});
}

function forgetDeviceKey(b: Broadcast): void {
	const keys = platform.vaultDeviceKeys;
	if (!keys) return;
	const done =
		b.type === 'clearedAll'
			? keys.removeAll()
			: b.type === 'cleared' || b.type === 'persistentDisabled'
				? keys.remove(b.accountId)
				: null;
	done?.catch((err) => console.warn('keystore: device key cleanup failed', err));
}

let devicePruned = false;

async function status(): Promise<StatusResponse> {
	const s = await call<StatusResponse>('status');
	const keys = platform.vaultDeviceKeys;
	if (keys && !devicePruned) {
		devicePruned = true;
		const keep = new Set(s.accounts.filter((a) => a.hasPersistent).map((a) => a.accountId));
		keys.prune(keep).catch((err) => console.warn('keystore: device key prune failed', err));
	}
	return s;
}

async function enrollPersistent(args: EnrollPersistentArgs): Promise<void> {
	const keys = platform.vaultDeviceKeys;
	try {
		await call<void>('enrollPersistent', { accountId: args.accountId, serverHalf: args.serverHalf });
		return;
	} catch (err) {
		if (!keys || !(err instanceof Error) || err.message !== LOCAL_KEY_UNSTORABLE) throw err;
	}
	await keys.create(args.accountId);
	try {
		const wrapKey = await keys.deriveWrapKey(args.accountId, args.serverHalf);
		if (!wrapKey) throw new Error('keystore: device key vanished during enrolment');
		await call<void>(
			'enrollPersistent',
			{ accountId: args.accountId, serverHalf: args.serverHalf, wrapKey },
			undefined,
			[wrapKey]
		);
	} catch (err) {
		await keys.remove(args.accountId).catch(() => undefined);
		throw err;
	}
}

async function tryRestoreFromPersistent(args: TryRestoreFromPersistentArgs): Promise<RestoreResponse> {
	const plain = { accountId: args.accountId, serverHalf: args.serverHalf };
	const keys = platform.vaultDeviceKeys;
	const wrapKey = keys ? await keys.deriveWrapKey(args.accountId, args.serverHalf) : null;
	if (!wrapKey) return call<RestoreResponse>('tryRestoreFromPersistent', plain);
	return call<RestoreResponse>('tryRestoreFromPersistent', { ...plain, wrapKey }, undefined, [
		wrapKey
	]);
}

async function alsoForgetDeviceKey(accountId: string | null, run: Promise<void>): Promise<void> {
	const keys = platform.vaultDeviceKeys;
	try {
		await run;
	} finally {
		if (keys) {
			await (accountId === null ? keys.removeAll() : keys.remove(accountId)).catch((err) =>
				console.warn('keystore: device key cleanup failed', err)
			);
		}
	}
}

function broadcastAccountId(b: Broadcast): string | null {
	switch (b.type) {
		case 'vaultChanged':
		case 'locked':
		case 'cleared':
		case 'persistentDisabled':
		case 'aliasKeysChanged':
		case 'accountKeysChanged':
			return b.accountId;
		case 'clearedAll':
			return null;
	}
}

export const keystore = {
	status,
	prepareLogin: (args: PrepareLoginArgs) => call<PrepareLoginResponse>('prepareLogin', args),
	verifyLoginProof: (args: VerifyLoginProofArgs) =>
		call<VerifyLoginProofResponse>('verifyLoginProof', args),
	completeLoginUnlock: (args: CompleteLoginUnlockArgs) =>
		call<CompleteLoginUnlockResponse>('completeLoginUnlock', args),
	abandonLogin: () => call<void>('abandonLogin'),
	opaqueStartRegistration: (args: OpaqueStartRegistrationArgs) =>
		call<OpaqueStartRegistrationResponse>('opaqueStartRegistration', args),
	opaqueFinishRegistration: (args: OpaqueFinishRegistrationArgs) =>
		call<OpaqueFinishRegistrationResponse>('opaqueFinishRegistration', {
			...args,
			serverClockOffsetMs: serverClockOffsetMs()
		}),
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
	migrationFinalized: (args: MigrationFinalizedArgs) =>
		call<MigrationFinalizedResponse>('migrationFinalized', args),
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
		alsoForgetDeviceKey(args.accountId, call<void>('invalidatePersistedVault', args)),
	abandonPasswordChange: () => call<void>('abandonPasswordChange'),
	touch: () => call<void>('touch'),
	prepareProductKeys: (args: PrepareProductKeysArgs) => call<PrepareProductKeysResponse>('prepareProductKeys', args),
	readProductKeys: (args: ReadProductKeysArgs) => call<ReadProductKeysResponse>('readProductKeys', args),
	sealProductHandoff: (args: SealProductHandoffArgs) => call<SealProductHandoffResponse>('sealProductHandoff', args),
	adoptHandoff: (args: AdoptHandoffArgs) => call<AdoptHandoffResponse>('adoptHandoff', args),
	commitHandoff: (args: CommitHandoffArgs) => call<CommitHandoffResponse>('commitHandoff', args),
	discardHandoff: (args: CommitHandoffArgs) => call<void>('discardHandoff', args),
	lock: (args: LockArgs) => call<void>('lock', args),
	clear: (args: ClearArgs) => alsoForgetDeviceKey(args.accountId, call<void>('clear', args)),
	clearAll: () => alsoForgetDeviceKey(null, call<void>('clearAll')),
	enrollPersistent,
	tryRestoreFromPersistent,
	disablePersistent: (args: DisablePersistentArgs) =>
		alsoForgetDeviceKey(args.accountId, call<void>('disablePersistent', args)),
	decrypt: (args: DecryptArgs) => call<DecryptResponse>('decrypt', args, CRYPTO_TIMEOUT_MS),
	attachmentHeader: (args: AttachmentHeaderArgs) =>
		call<AttachmentHeaderResponse>('attachmentHeader', args, ATTACHMENT_HEADER_TIMEOUT_MS),
	attachmentBytes: (args: AttachmentBytesArgs) =>
		call<AttachmentBytesResponse>('attachmentBytes', args, ATTACHMENT_BYTES_TIMEOUT_MS),
	loadAliasKeys: (args: LoadAliasKeysArgs) => call<LoadAliasKeysResponse>('loadAliasKeys', args),
	unloadAliasKeys: (args: UnloadAliasKeysArgs) => call<void>('unloadAliasKeys', args),
	createAliasKey: (args: CreateAliasKeyArgs) =>
		call<CreateAliasKeyResponse>(
			'createAliasKey',
			{ ...args, serverClockOffsetMs: serverClockOffsetMs() },
			CRYPTO_TIMEOUT_MS
		),
	createSigningDelegationKey: (args: CreateSigningDelegationKeyArgs) =>
		call<CreateSigningDelegationKeyResponse>(
			'createSigningDelegationKey',
			{ ...args, serverClockOffsetMs: serverClockOffsetMs() },
			CRYPTO_TIMEOUT_MS
		),
	getPublicKey: (args: GetPublicKeyArgs) => call<GetPublicKeyResponse>('getPublicKey', args),
	loadAccountKeys: (args: LoadAccountKeysArgs) =>
		call<LoadAccountKeysResponse>('loadAccountKeys', args, CRYPTO_TIMEOUT_MS),
	listAccountKeys: (args: ListAccountKeysArgs) =>
		call<ListAccountKeysResponse>('listAccountKeys', args),
	prepareKeyRotation: (args: Omit<PrepareKeyRotationArgs, 'serverClockOffsetMs'>) =>
		call<PrepareKeyRotationResponse>(
			'prepareKeyRotation',
			{ ...args, serverClockOffsetMs: serverClockOffsetMs() },
			CRYPTO_TIMEOUT_MS
		),
	commitKeyRotation: (args: CommitKeyRotationArgs) =>
		call<CommitKeyRotationResponse>('commitKeyRotation', args),
	abandonKeyRotation: (args: AbandonKeyRotationArgs) => call<void>('abandonKeyRotation', args),
	reformatKeyWithUids: (args: ReformatKeyWithUidsArgs) =>
		call<ReformatKeyWithUidsResponse>('reformatKeyWithUids', args, CRYPTO_TIMEOUT_MS),
	commitReformattedKey: (args: CommitReformattedKeyArgs) =>
		call<CommitReformattedKeyResponse>('commitReformattedKey', args),
	encrypt: (args: EncryptArgs) => call<EncryptResponse>('encrypt', args, CRYPTO_TIMEOUT_MS),
	encryptToKeys: (args: EncryptToKeysArgs) =>
		call<EncryptToKeysResponse>('encryptToKeys', args, CRYPTO_TIMEOUT_MS),
	signInvitation: (args: SignInvitationArgs) => call<CalendarStatementResponse>('signInvitation', args),
	signReply: (args: SignReplyArgs) => call<CalendarStatementResponse>('signReply', args),
	signFreeBusy: (args: SignFreeBusyArgs) => call<CalendarStatementResponse>('signFreeBusy', args),
	signCalendarGrant: (args: SignCalendarGrantArgs) => call<CalendarStatementResponse>('signCalendarGrant', args),
	createCalendarKey: (args: CreateCalendarKeyArgs) => call<CreateCalendarKeyResponse>('createCalendarKey', args),
	loadCalendarKeys: (args: LoadCalendarKeysArgs) => call<LoadCalendarKeysResponse>('loadCalendarKeys', args),
	signDetached: (args: SignDetachedArgs) => call<SignDetachedResponse>('signDetached', args),
	sealIndex: (args: SealIndexArgs) => call<SealIndexResponse>('sealIndex', args, CRYPTO_TIMEOUT_MS),
	openIndex: (args: OpenIndexArgs) => call<OpenIndexResponse>('openIndex', args, CRYPTO_TIMEOUT_MS),
	sealProductFork: (args: SealProductForkArgs) =>
		call<SealProductForkResponse>('sealProductFork', args, CRYPTO_TIMEOUT_MS),
	openProductFork: (args: OpenProductForkArgs) =>
		call<OpenProductForkResponse>('openProductFork', args, CRYPTO_TIMEOUT_MS),
	subscribe(cb: (b: Broadcast) => void): () => void {
		const channel = platform.keystoreChannel as KeystoreChannel<Broadcast> | undefined;
		if (channel) return channel.subscribe(cb);
		const s = getSingleton();
		s.listeners.add(cb);
		return () => s.listeners.delete(cb);
	},
	subscribeAccount(accountId: string, cb: (b: Broadcast) => void): () => void {
		const wrapped = (b: Broadcast) => {
			const id = broadcastAccountId(b);
			if (id === null || id === accountId) cb(b);
		};
		const channel = platform.keystoreChannel as KeystoreChannel<Broadcast> | undefined;
		if (channel) return channel.subscribe(wrapped);
		const s = getSingleton();
		s.listeners.add(wrapped);
		return () => s.listeners.delete(wrapped);
	}
};
