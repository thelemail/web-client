export type ErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "rate_limited"
  | "unsupported_parameters"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "internal_error"
  | "service_unavailable"
  | "account_pending_deletion"
  | "workspace_transfer_required"
  | "read_only"
  | "account_suspended"
  | "trial_feature_locked"
  | "migration_conflict";

export type MessageDirection = "sent" | "received";
export type MessageSource =
  | "internal"
  | "inbound_external"
  | "outbound_external";
export type MailboxState = "inbox" | "archive" | "trash" | "spam" | "snoozed";

export interface MailboxCounts {
  inbox: number;
  starred: number;
  spam: number;
  snoozed: number;
}

export interface MessageState {
  id: string;
  mailboxState: MailboxState;
  starred: boolean;
  starredAt?: string | null;
  read: boolean;
  readAt?: string | null;
  snoozedUntil?: string | null;
}

export interface SnoozeRequest {
  until: string;
}

export type RsvpStatus = "accepted" | "tentative" | "declined";

export type SortOrder = "newest" | "oldest";

export interface MessageListItem {
  id: string;
  ownerAccountId: string;
  direction: MessageDirection;
  source: MessageSource;
  storedAt: string;
  bodySizeBytes: number;
  attachmentCount: number;
  totalAttachmentBytes: number;
  encryptedPreview: string;
  previewKeyFingerprint?: string;
  encrypted?: boolean;
  signatureStatus?: SignatureStatus;
  signerKeyFingerprint?: string;
  schemaVersion: number;
  mailboxState: MailboxState;
  starred: boolean;
  starredAt?: string | null;
  read: boolean;
  readAt?: string | null;
  snoozedUntil?: string | null;
  threadRootId?: string | null;
  rsvpStatus?: RsvpStatus | null;
  threadCount?: number | null;
  labels?: string[];
}

export interface MessageListResponse {
  items: MessageListItem[];
  nextCursor?: string | null;
}

export interface PresignedPointer {
  url: string;
  expiresAt: string;
  sizeBytes: number;
  sha256?: string;
  keyFingerprint?: string;
}

export interface AttachmentDetail {
  id: string;
  ordinal: number;
  pointer: PresignedPointer;
  isInline: boolean;
}

export interface MessageDetail {
  id: string;
  ownerAccountId: string;
  direction: MessageDirection;
  source: MessageSource;
  storedAt: string;
  encryptedPreview: string;
  previewKeyFingerprint?: string;
  encrypted?: boolean;
  signatureStatus?: SignatureStatus;
  signerKeyFingerprint?: string;
  schemaVersion: number;
  body: PresignedPointer;
  attachments: AttachmentDetail[];
  mailboxState: MailboxState;
  starred: boolean;
  starredAt?: string | null;
  read: boolean;
  readAt?: string | null;
  snoozedUntil?: string | null;
  externalMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  threadRootId?: string | null;
  rsvpStatus?: RsvpStatus | null;
  rsvpEventUid?: string | null;
  labels?: string[];
}

export interface LabelsRequest {
  labels: string[];
}

export type MessageReportKind = "spam" | "phishing";

export interface ReportMessageRequest {
  kind: MessageReportKind;
  headers?: string;
  senderAddress?: string;
}

export interface BlockedSender {
  id: string;
  createdAt: string;
  sealedLabel?: string | null;
}

export interface BlockedSenderListResponse {
  blockedSenders: BlockedSender[];
}

export interface AddBlockedSenderRequest {
  address: string;
  sealedLabel?: string | null;
}

export interface ThreadResponse {
  threadRootId: string;
  items: MessageDetail[];
}

export interface ThreadListItem {
  threadKey: string;
  latest: MessageListItem;
  messageCount: number;
  unreadCount: number;
  hasAttachments: boolean;
  starred: boolean;
}

export interface ThreadListResponse {
  items: ThreadListItem[];
  nextCursor?: string | null;
}

export interface RsvpRequest {
  status: RsvpStatus;
  eventUid: string;
}

export type SendSource = "internal";

export interface AttachmentDescriptor {
  ordinal: number;
  objectKey: string;
  ciphertextSizeBytes: number;
  ciphertextSha256: string;
  keyFingerprint: string;
}

export type AttachmentUploadSlotRole = "sender" | "recipient";

export interface AttachmentUploadSlotRequest {
  slotId: string;
  role: AttachmentUploadSlotRole;
  recipientAccountId?: string;
  ordinal: number;
  ciphertextSizeBytes: number;
  ciphertextSha256: string;
  keyFingerprint: string;
}

export interface AttachmentUploadGrant {
  slotId: string;
  objectKey: string;
  putUrl: string;
  expiresAt: string;
}

export interface AttachmentUploadUrlsRequest {
  slots: AttachmentUploadSlotRequest[];
}

export interface AttachmentUploadUrlsResponse {
  slots: AttachmentUploadGrant[];
}

export interface SendEnvelope {
  encryptedPreview: string;
  previewKeyFingerprint: string;
  encryptedBody: string;
  bodyKeyFingerprint: string;
  bodySha256: string;
  bodySizeBytes: number;
  attachments: AttachmentDescriptor[];
}

export interface DraftRequest {
  schemaVersion: number;
  sealed: SendEnvelope;
}

export interface DraftSummary {
  id: string;
  updatedAt: string;
  attachmentCount: number;
}

export interface DraftListItem {
  id: string;
  updatedAt: string;
  encryptedPreview: string;
  previewKeyFingerprint?: string;
  attachmentCount: number;
  schemaVersion: number;
}

export interface DraftListResponse {
  items: DraftListItem[];
  nextCursor?: string | null;
}

export interface DraftDetail {
  id: string;
  updatedAt: string;
  encryptedPreview: string;
  previewKeyFingerprint?: string;
  schemaVersion: number;
  body: PresignedPointer;
  attachments: AttachmentDetail[];
}

export interface StagingSlotRequest {
  slotId: string;
  ordinal: number;
  plaintextSizeBytes: number;
}

export interface StagingSlotGrant {
  slotId: string;
  objectKey: string;
  putUrl: string;
  expiresAt: string;
}

export interface StagingUrlsRequest {
  slots: StagingSlotRequest[];
}

export interface StagingUrlsResponse {
  slots: StagingSlotGrant[];
}

export interface StagedAttachment {
  stagingSlotId: string;
  filename: string;
  contentType: string;
  disposition: "attachment" | "inline";
  contentId?: string;
  plaintextSizeBytes: number;
  plaintextSha256?: string;
  ordinal: number;
}

export interface SendRecipient {
  accountId: string;
  envelope: SendEnvelope;
}

export interface InternalSendRequest {
  idempotencyKey: string;
  schemaVersion: number;
  source: SendSource;
  sent: SendEnvelope;
  recipients: SendRecipient[];
  externalMessageId?: string;
  inReplyToMessageId?: string;
  inReplyToHeader?: string;
  references?: string[];
  scheduledAt?: string;
}

export interface InternalSendResponse {
  messageId: string;
  storedAt: string;
  scheduledAt?: string | null;
  scheduledSendId?: string | null;
}

export type ScheduledSendKind = "internal" | "external";

export interface ScheduledSend {
  id: string;
  kind: ScheduledSendKind;
  scheduledAt: string;
  createdAt: string;
  encryptedPreview: string;
  previewKeyFingerprint?: string;
}

export interface ScheduledSendListResponse {
  items: ScheduledSend[];
  nextCursor?: string | null;
}

export interface ImportAttachmentDescriptor {
  ordinal: number;
  objectKey: string;
  ciphertextSizeBytes: number;
  ciphertextSha256: string;
  keyFingerprint: string;
  isInline: boolean;
  contentIdHash?: string;
}

export interface ClientImportEnvelope {
  encryptedPreview: string;
  previewKeyFingerprint: string;
  bodyObjectKey: string;
  bodyKeyFingerprint: string;
  bodySha256: string;
  bodySizeBytes: number;
}

export interface FetchImagesRequest {
  urls: string[];
}

export interface FetchedImage {
  url: string;
  contentType: string;
  dataBase64: string;
}

export interface FetchImagesResponse {
  images: FetchedImage[];
}

export interface ResolveBimiRequest {
  domains: string[];
}

export interface ResolveBimiResponse {
  eligible: string[];
}

export interface ClientInboundImportRequest {
  schemaVersion: number;
  storedAt: string;
  externalMessageId?: string;
  contentHash: string;
  inReplyToHeader?: string;
  references?: string[];
  sent: ClientImportEnvelope;
  attachments: ImportAttachmentDescriptor[];
}

export interface ClientInboundImportResponse {
  messageId: string;
  storedAt: string;
  existing: boolean;
}

export interface EncryptedCopy {
  encryptedBody: string;
  addresses: string[];
}

export interface RecipientParty {
  name?: string;
  address: string;
}

export interface SubmitMessageRequest {
  idempotencyKey: string;
  schemaVersion: number;
  from?: string;
  to: RecipientParty[];
  cc?: RecipientParty[];
  bcc?: RecipientParty[];
  subject: string;
  textBody?: string;
  htmlBody?: string;
  replyTo?: string;
  inReplyToHeader?: string;
  references?: string[];
  calendar?: { method: "REQUEST" | "REPLY" | "CANCEL"; ics: string };
  sent?: SendEnvelope;
  sentMessageId?: string;
  stagedAttachments?: StagedAttachment[];
  encryptedCopies?: EncryptedCopy[];
  scheduledAt?: string;
}

export type SubmitRecipientStatus = "encrypted" | "downgraded" | "blocked";

export interface SubmitMessageResponse {
  messageId: string;
  enqueuedAt: string;
  recipients?: { address: string; status: SubmitRecipientStatus }[];
  scheduledAt?: string | null;
  scheduledSendId?: string | null;
}

export type SignatureStatus =
  | "unsigned"
  | "verified"
  | "unverified"
  | "unknown_key"
  | "encrypted";

export interface ExternalKeyTrust {
  address: string;
  fingerprint: string;
  algorithm: string;
  armoredKey: string;
  source: "wkd" | "keyserver" | "manual";
  status: "pinned" | "changed" | "unverified";
  firstSeenAt: string;
}

export interface ApiError {
  code: ErrorCode;
  message: string;
  requestId?: string;
  retryAfterSeconds?: number;
}

export interface ErrorEnvelope {
  error: ApiError;
}

export interface ModulusResponse {
  modulus: string;
}

export interface RegistrationInitRequest {
  email: string;
  registrationRequest: string;
}

export interface RegistrationInitResponse {
  registrationId: string;
  accountId: string;
  registrationResponse: string;
  ttlSeconds: number;
}

export interface RegisterRequest {
  email: string;
  fullName: string;
  registrationId: string;
  opaqueRecord: string;
  wrappedMasterKey: string;
  masterKeyId: string;
  opaqueParamsVersion: number;
  publicKey: string;
  encryptedPrivateKey: string;
  keyAlgorithm: "openpgp-curve25519-v6";
  startTrial?: boolean;
  source?: string;
}

export interface RegisterResponse {
  status: "accepted";
}

export interface OpaqueKsfInfo {
  name: string;
  timeCost: number;
  memoryKib: number;
  threads: number;
  salt: string;
  outputLength: number;
}

export interface OpaqueParametersResponse {
  opaqueParamsVersion: number;
  oprf: string;
  ake: string;
  kdf: string;
  mac: string;
  hash: string;
  ksf: OpaqueKsfInfo;
  keyFingerprint: string;
}

export interface LoginInitRequest {
  email: string;
  ke1?: string;
}

export interface LoginInitResponse {
  challengeId: string;
  challengeTtlSeconds: number;
  salt?: string;
  serverPublicEphemeral?: string;
  modulus?: string;
  kdfParamsVersion?: number;
  srpParamsVersion?: number;
  accountId?: string;
  ke2?: string;
}

export interface LoginCompleteRequest {
  challengeId: string;
  clientPublicEphemeral?: string;
  clientProof?: string;
  ke3?: string;
  enrollPersistentSession?: boolean;
}

export type TwoFactorMethod = "totp" | "webauthn" | "backupCode";

export interface TwoFactorPending {
  pendingToken: string;
  expiresInSeconds: number;
  methods: TwoFactorMethod[];
}

export interface LoginSessionGrant {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  accountId: string;
  encryptedPrivateKey: string;
  keySalt?: string;
  kdfParamsVersion?: number;
  wrappedMasterKey?: string;
  masterKeyId?: string;
  opaqueParamsVersion?: number;
  serverHalf?: string;
  migrationStageGrant?: string;
  migrationStageGrantTtlSeconds?: number;
  migrationFinalizeGrant?: string;
  migrationFinalizeGrantTtlSeconds?: number;
  staged?: boolean;
}

export interface RecoveryGrant {
  accountId?: string;
  encryptedPrivateKey: string;
  keySalt?: string;
  kdfParamsVersion?: number;
  wrappedMasterKey?: string;
  opaqueParamsVersion?: number;
  authScheme?: "srp_v1" | "opaque_v1";
  resetToken: string;
  resetTokenExpiresInSeconds: number;
}

export interface PasswordChangeGrant {
  changeToken: string;
  changeTokenExpiresInSeconds: number;
}

export interface LoginCompleteResponse extends Partial<LoginSessionGrant> {
  serverProof?: string;
  accountId: string;
  twoFactor?: TwoFactorPending;
}

export type TwoFactorVerifyResponse = {
  scope:
    | "login"
    | "recovery"
    | "password_change"
    | "migration_stage"
    | "migration_finalize";
  accountId: string;
  authScheme?: "srp_v1" | "opaque_v1";
} & Partial<LoginSessionGrant & RecoveryGrant & PasswordChangeGrant>;

export interface MigrationStatusResponse {
  authScheme: "srp_v1" | "opaque_v1";
  migrationState?: "staged";
  masterKeyId?: string;
  credentialGeneration: number;
  recoveryScheme?: "srp_v1" | "opaque_v1";
}

export interface MigrationRegistrationInitRequest {
  grantToken: string;
  registrationRequest: string;
}

export interface MigrationRegistrationInitResponse {
  registrationResponse: string;
}

export interface MigrationStageRequest {
  grantToken: string;
  opaqueRecord: string;
  wrappedMasterKey: string;
  masterKeyId: string;
  opaqueParamsVersion: number;
  stagedEncryptedPrivateKey: string;
}

export interface MigrationFinalizeRequest {
  finalizeToken: string;
}

export interface PasswordChangeInitResponse {
  challengeId: string;
  salt: string;
  serverPublicEphemeral: string;
  modulus: string;
  kdfParamsVersion: number;
  srpParamsVersion: number;
  challengeTtlSeconds: number;
}

export interface PasswordChangeVerifyRequest {
  challengeId: string;
  clientPublicEphemeral: string;
  clientProof: string;
}

export interface PasswordChangeVerifyResponse
  extends Partial<PasswordChangeGrant> {
  serverProof: string;
  twoFactor?: TwoFactorPending;
}

export interface PasswordChangeCompleteRequest {
  changeToken: string;
  srpSalt: string;
  srpVerifier: string;
  keySalt: string;
  encryptedPrivateKey: string;
  kdfParamsVersion: number;
  srpParamsVersion: number;
}

export interface PasswordChangeOpaqueInitRequest {
  ke1: string;
}

export interface PasswordChangeOpaqueInitResponse {
  challengeId: string;
  ke2: string;
  challengeTtlSeconds: number;
}

export interface PasswordChangeOpaqueRegistrationInitRequest {
  registrationRequest: string;
}

export interface PasswordChangeOpaqueRegistrationInitResponse {
  registrationResponse: string;
}

export interface PasswordChangeOpaqueVerifyRequest {
  challengeId: string;
  ke3: string;
}

export interface PasswordChangeOpaqueVerifyResponse {
  twoFactor?: TwoFactorPending;
  changeToken?: string;
  changeTokenExpiresInSeconds?: number;
}

export interface PasswordChangeCompleteOpaqueRequest {
  changeToken: string;
  opaqueRecord: string;
  wrappedMasterKey: string;
  masterKeyId: string;
  opaqueParamsVersion: number;
}

export interface TwoFactorWebauthnCredential {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  backupState?: boolean;
}

export interface TwoFactorStatus {
  enabled: boolean;
  totp?: { active: boolean; createdAt: string };
  webauthnCredentials: TwoFactorWebauthnCredential[];
  backupCodes?: { remaining: number; generatedAt?: string };
}

export type TwoFactorProof =
  | { method: "totp"; code: string }
  | { method: "backupCode"; code: string }
  | { method: "webauthn"; proofToken: string; credential: unknown };

export interface DeletionInitResponse {
  challengeId: string;
  salt: string;
  serverPublicEphemeral: string;
  modulus: string;
  kdfParamsVersion: number;
  srpParamsVersion: number;
  challengeTtlSeconds: number;
}

export interface DeletionConfirmRequest {
  challengeId: string;
  clientPublicEphemeral: string;
  clientProof: string;
  proof?: TwoFactorProof;
}

export interface DeletionConfirmResponse {
  serverProof?: string;
  requestedAt: string;
  purgeAt: string;
}

export interface AccountDeletionOpaqueInitRequest {
  ke1: string;
}

export interface AccountDeletionOpaqueInitResponse {
  challengeId: string;
  ke2: string;
  challengeTtlSeconds: number;
}

export interface AccountDeletionOpaqueConfirmRequest {
  challengeId: string;
  ke3: string;
  proof?: TwoFactorProof;
}

export interface PersistentHalfResponse {
  serverHalf: string;
}

export interface RefreshResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  accountId: string;
}

export type SessionClient = "web" | "mobile" | "desktop";

export interface SessionInfo {
  id: string;
  client: SessionClient;
  createdAt: string;
  lastUsedAt?: string;
  current: boolean;
}

export interface SessionListResponse {
  sessions: SessionInfo[];
}

export type SecurityEventAction =
  | "signed_in"
  | "signed_out"
  | "session_revoked"
  | "other_sessions_revoked"
  | "password_changed"
  | "recovery_phrase_set"
  | "account_recovered"
  | "totp_enabled"
  | "totp_disabled"
  | "webauthn_added"
  | "webauthn_removed"
  | "backup_codes_regenerated"
  | "account_deletion_requested"
  | "account_deletion_canceled";

export interface SecurityEventInfo {
  id: string;
  action: SecurityEventAction;
  client: SessionClient;
  occurredAt: string;
}

export interface SecurityEventListResponse {
  events: SecurityEventInfo[];
  nextCursor?: string | null;
}

export interface RecoverySetupRequest {
  srpSalt: string;
  srpVerifier: string;
  keySalt: string;
  encryptedPrivateKey: string;
  kdfParamsVersion: number;
  srpParamsVersion: number;
}

export interface RecoveryInitRequest {
  email: string;
}

export interface RecoveryInitResponse {
  challengeId: string;
  salt: string;
  serverPublicEphemeral: string;
  modulus: string;
  kdfParamsVersion: number;
  srpParamsVersion: number;
  challengeTtlSeconds: number;
}

export interface RecoveryCompleteRequest {
  challengeId: string;
  clientPublicEphemeral: string;
  clientProof: string;
}

export interface RecoveryCompleteResponse extends Partial<RecoveryGrant> {
  serverProof?: string;
  twoFactor?: TwoFactorPending;
}

export interface RecoveryResetRequest {
  resetToken: string;
  srpSalt: string;
  srpVerifier: string;
  keySalt: string;
  encryptedPrivateKey: string;
  kdfParamsVersion: number;
  srpParamsVersion: number;
}

export interface RecoverySetupOpaqueRequest {
  opaqueRecord: string;
  wrappedMasterKey: string;
  masterKeyId: string;
  opaqueParamsVersion: number;
}

export interface RecoveryOpaqueRegistrationInitRequest {
  registrationRequest: string;
}

export interface RecoveryOpaqueRegistrationInitResponse {
  registrationResponse: string;
}

export interface RecoveryOpaqueInitRequest {
  email: string;
  ke1: string;
}

export interface RecoveryOpaqueInitResponse {
  challengeId: string;
  accountId: string;
  ke2: string;
  challengeTtlSeconds: number;
}

export interface RecoveryOpaqueCompleteRequest {
  challengeId: string;
  ke3: string;
}

export interface RecoveryOpaqueCompleteResponse {
  twoFactor?: TwoFactorPending;
  encryptedPrivateKey?: string;
  wrappedMasterKey?: string;
  opaqueParamsVersion?: number;
  resetToken?: string;
  resetTokenExpiresInSeconds?: number;
}

export interface RecoveryResetOpaqueRegistrationInitRequest {
  resetToken: string;
  registrationRequest: string;
}

export interface RecoveryResetOpaqueRegistrationInitResponse {
  registrationResponse: string;
}

export interface RecoveryResetOpaqueRequest {
  resetToken: string;
  opaqueRecord: string;
  wrappedMasterKey: string;
  masterKeyId: string;
  opaqueParamsVersion: number;
}

export interface RecoveryResetAmkRotationRequest {
  resetToken: string;
  opaqueRecord: string;
  wrappedMasterKey: string;
  masterKeyId: string;
  opaqueParamsVersion: number;
  encryptedPrivateKey: string;
}

export interface DeletionStatus {
  requestedAt: string;
  purgeAt: string;
}

export type LifecycleStageWire =
  | "active"
  | "grace"
  | "suspended"
  | "pending_deletion";
export type LifecycleCohort = "trial" | "ex_paid";

export interface LifecycleWelcomeBack {
  messagesDuringGrace?: number;
  bounceFrom?: string | null;
  bounceTo?: string | null;
}

export interface LifecycleInfo {
  stage: LifecycleStageWire;
  cohort: LifecycleCohort;
  day0: string;
  suspendAt: string;
  deletionDate: string;
  trialEnd?: string | null;
  expiryScreenShown: boolean;
  welcomeBack?: LifecycleWelcomeBack | null;
}

export interface MeResponse {
  accountId: string;
  email: string;
  fullName: string;
  status: "active" | "disabled" | "suspended";
  createdAt: string;
  recoveryEnabled?: boolean;
  avatarUrl?: string | null;
  defaultReplyAddressId?: string | null;
  deletion?: DeletionStatus | null;
  lifecycle?: LifecycleInfo | null;
}

export interface DirectoryStatementWire {
  address: string;
  accountId: string;
  keyFingerprint: string;
  keyAlgorithm: string;
  version: number;
  issuedAt: string;
  signingKeyFingerprint: string;
}

export interface AccountLookupResponse {
  accountId: string;
  email: string;
  fullName: string;
  workspaceId?: string;
  publicKeyArmored: string;
  directoryStatement: DirectoryStatementWire;
  directorySignature: string;
  tlogProof?: string;
}

export interface AccountSettingsResponse {
  sections: Record<string, Record<string, unknown>>;
}

export interface AccountSettingsSectionResponse {
  section: string;
  value: Record<string, unknown>;
}

export class ApiCallError extends Error {
  status: number;
  envelope: ErrorEnvelope | null;
  constructor(status: number, envelope: ErrorEnvelope | null, message: string) {
    super(message);
    this.status = status;
    this.envelope = envelope;
    this.name = "ApiCallError";
  }
}
