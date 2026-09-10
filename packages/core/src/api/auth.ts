import { apiFetch } from './client';
import type {
	LoginCompleteRequest,
	LoginCompleteResponse,
	LoginInitRequest,
	LoginInitResponse,
	MeResponse,
	MigrationFinalizeRequest,
	MigrationRegistrationInitRequest,
	MigrationRegistrationInitResponse,
	MigrationStageRequest,
	MigrationStatusResponse,
	ModulusResponse,
	OpaqueParametersResponse,
	PasswordChangeCompleteOpaqueRequest,
	PasswordChangeCompleteRequest,
	PasswordChangeInitResponse,
	PasswordChangeOpaqueInitRequest,
	PasswordChangeOpaqueInitResponse,
	PasswordChangeOpaqueRegistrationInitRequest,
	PasswordChangeOpaqueRegistrationInitResponse,
	PasswordChangeOpaqueVerifyRequest,
	PasswordChangeOpaqueVerifyResponse,
	PasswordChangeVerifyRequest,
	PasswordChangeVerifyResponse,
	PersistentHalfResponse,
	RecoveryCompleteRequest,
	RecoveryCompleteResponse,
	RecoveryInitRequest,
	RecoveryInitResponse,
	RecoveryOpaqueCompleteRequest,
	RecoveryOpaqueCompleteResponse,
	RecoveryOpaqueInitRequest,
	RecoveryOpaqueInitResponse,
	RecoveryOpaqueRegistrationInitRequest,
	RecoveryOpaqueRegistrationInitResponse,
	RecoveryResetAmkRotationRequest,
	RecoveryResetOpaqueRegistrationInitRequest,
	RecoveryResetOpaqueRegistrationInitResponse,
	RecoveryResetOpaqueRequest,
	RecoveryResetRequest,
	RecoverySetupOpaqueRequest,
	RecoverySetupRequest,
	RefreshResponse,
	RegisterRequest,
	RegisterResponse,
	RegistrationInitRequest,
	RegistrationInitResponse,
	SecurityEventListResponse,
	SessionListResponse
} from './types';

export function getModulus() {
	return apiFetch<ModulusResponse>('/v1/auth/modulus', { method: 'GET', skipAuth: true });
}

export function getOpaqueParameters() {
	return apiFetch<OpaqueParametersResponse>('/v1/auth/opaque-parameters', {
		method: 'GET',
		skipAuth: true
	});
}

export function checkAddressAvailability(localPart: string) {
	const qs = new URLSearchParams({ localPart }).toString();
	return apiFetch<{ available: boolean }>(`/v1/auth/address-available?${qs}`, {
		method: 'GET',
		skipAuth: true
	});
}

export function registrationInit(req: RegistrationInitRequest) {
	return apiFetch<RegistrationInitResponse>('/v1/auth/registration/init', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function register(req: RegisterRequest) {
	return apiFetch<RegisterResponse>('/v1/auth/register', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function loginInit(req: LoginInitRequest) {
	return apiFetch<LoginInitResponse>('/v1/auth/login/init', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function loginComplete(req: LoginCompleteRequest) {
	return apiFetch<LoginCompleteResponse>('/v1/auth/login/complete', {
		method: 'POST',
		body: req,
		skipAuth: true,
		headers: { 'X-Client': 'web' }
	});
}

export function getMigrationStatus(accountId?: string) {
	return apiFetch<MigrationStatusResponse>('/v1/auth/migration/status', {
		method: 'GET',
		accountId
	});
}

export function migrationRegistrationInit(req: MigrationRegistrationInitRequest) {
	return apiFetch<MigrationRegistrationInitResponse>('/v1/auth/migration/registration-init', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function migrationStage(req: MigrationStageRequest) {
	return apiFetch<MigrationStatusResponse>('/v1/auth/migration/stage', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function migrationFinalize(req: MigrationFinalizeRequest) {
	return apiFetch<void>('/v1/auth/migration/finalize', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function recoverySetup(req: RecoverySetupRequest, accountId?: string) {
	return apiFetch<void>('/v1/auth/recovery/setup', {
		method: 'POST',
		body: req,
		accountId
	});
}

export function recoverySetupOpaque(req: RecoverySetupOpaqueRequest, accountId?: string) {
	return apiFetch<void>('/v1/auth/recovery/setup-opaque', {
		method: 'POST',
		body: req,
		accountId
	});
}

export function recoveryOpaqueRegistrationInit(
	req: RecoveryOpaqueRegistrationInitRequest,
	accountId?: string
) {
	return apiFetch<RecoveryOpaqueRegistrationInitResponse>(
		'/v1/auth/recovery/opaque/registration-init',
		{ method: 'POST', body: req, accountId }
	);
}

export function recoveryInit(req: RecoveryInitRequest) {
	return apiFetch<RecoveryInitResponse>('/v1/auth/recovery/init', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function recoveryOpaqueInit(req: RecoveryOpaqueInitRequest) {
	return apiFetch<RecoveryOpaqueInitResponse>('/v1/auth/recovery/opaque/init', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function recoveryComplete(req: RecoveryCompleteRequest) {
	return apiFetch<RecoveryCompleteResponse>('/v1/auth/recovery/complete', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function recoveryOpaqueComplete(req: RecoveryOpaqueCompleteRequest) {
	return apiFetch<RecoveryOpaqueCompleteResponse>('/v1/auth/recovery/opaque/complete', {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function recoveryReset(req: RecoveryResetRequest) {
	return apiFetch<void>('/v1/auth/recovery/reset', {
		method: 'POST',
		body: req,
		skipAuth: true,
		skipRetryOnUnauthorized: true,
		headers: { 'X-Client': 'web' }
	});
}

export function recoveryResetOpaqueRegistrationInit(req: RecoveryResetOpaqueRegistrationInitRequest) {
	return apiFetch<RecoveryResetOpaqueRegistrationInitResponse>(
		'/v1/auth/recovery/reset-opaque/registration-init',
		{ method: 'POST', body: req, skipAuth: true }
	);
}

export function recoveryResetOpaque(req: RecoveryResetOpaqueRequest) {
	return apiFetch<void>('/v1/auth/recovery/reset-opaque', {
		method: 'POST',
		body: req,
		skipAuth: true,
		skipRetryOnUnauthorized: true,
		headers: { 'X-Client': 'web' }
	});
}

export function recoveryResetAmkRotation(req: RecoveryResetAmkRotationRequest) {
	return apiFetch<void>('/v1/auth/recovery/reset-amk-rotation', {
		method: 'POST',
		body: req,
		skipAuth: true,
		skipRetryOnUnauthorized: true,
		headers: { 'X-Client': 'web' }
	});
}

export function passwordChangeInit(accountId?: string) {
	return apiFetch<PasswordChangeInitResponse>('/v1/auth/password/init', {
		method: 'POST',
		accountId
	});
}

export function passwordChangeVerify(req: PasswordChangeVerifyRequest, accountId?: string) {
	return apiFetch<PasswordChangeVerifyResponse>('/v1/auth/password/verify', {
		method: 'POST',
		body: req,
		accountId
	});
}

export function passwordChangeComplete(req: PasswordChangeCompleteRequest, accountId?: string) {
	return apiFetch<void>('/v1/auth/password/complete', {
		method: 'POST',
		body: req,
		accountId
	});
}

export function passwordChangeOpaqueInit(req: PasswordChangeOpaqueInitRequest, accountId?: string) {
	return apiFetch<PasswordChangeOpaqueInitResponse>('/v1/auth/password/opaque/init', {
		method: 'POST',
		body: req,
		accountId
	});
}

export function passwordChangeOpaqueRegistrationInit(
	req: PasswordChangeOpaqueRegistrationInitRequest,
	accountId?: string
) {
	return apiFetch<PasswordChangeOpaqueRegistrationInitResponse>(
		'/v1/auth/password/opaque/registration-init',
		{ method: 'POST', body: req, accountId }
	);
}

export function passwordChangeOpaqueVerify(req: PasswordChangeOpaqueVerifyRequest, accountId?: string) {
	return apiFetch<PasswordChangeOpaqueVerifyResponse>('/v1/auth/password/opaque/verify', {
		method: 'POST',
		body: req,
		accountId
	});
}

export function passwordChangeCompleteOpaque(
	req: PasswordChangeCompleteOpaqueRequest,
	accountId?: string
) {
	return apiFetch<void>('/v1/auth/password/complete-opaque', {
		method: 'POST',
		body: req,
		accountId
	});
}


export function refreshSession(accountId: string) {
	return apiFetch<RefreshResponse>('/v1/auth/refresh', {
		method: 'POST',
		skipAuth: true,
		skipRetryOnUnauthorized: true,
		accountId
	});
}

export function logout(accountId: string) {
	return apiFetch<void>('/v1/auth/logout', {
		method: 'POST',
		skipAuth: true,
		skipRetryOnUnauthorized: true,
		accountId
	});
}

export function logoutAll() {
	return apiFetch<void>('/v1/auth/logout/all', {
		method: 'POST',
		skipAuth: true,
		skipRetryOnUnauthorized: true
	});
}

export function listSessions(accountId?: string) {
	return apiFetch<SessionListResponse>('/v1/auth/sessions', { method: 'GET', accountId });
}

export function revokeSession(sessionId: string, accountId?: string) {
	return apiFetch<void>(`/v1/auth/sessions/${sessionId}`, {
		method: 'DELETE',
		accountId
	});
}

export function revokeOtherSessions(accountId?: string) {
	return apiFetch<void>('/v1/auth/sessions/revoke-others', {
		method: 'POST',
		accountId
	});
}

export function listSecurityEvents(opts?: { limit?: number; cursor?: string }, accountId?: string) {
	const params = new URLSearchParams();
	if (opts?.limit) params.set('limit', String(opts.limit));
	if (opts?.cursor) params.set('cursor', opts.cursor);
	const qs = params.toString();
	return apiFetch<SecurityEventListResponse>(`/v1/auth/security-events${qs ? `?${qs}` : ''}`, {
		method: 'GET',
		accountId
	});
}

export function getPersistentHalf(accountId: string) {
	return apiFetch<PersistentHalfResponse>('/v1/auth/session/persistent-half', {
		method: 'POST',
		skipAuth: true,
		skipRetryOnUnauthorized: true,
		accountId
	});
}

export function getMe(accountId?: string) {
	return apiFetch<MeResponse>('/v1/me', { method: 'GET', accountId });
}

export function disablePersistentHalf(accountId: string) {
	return apiFetch<void>('/v1/auth/session/persistent-half/disable', {
		method: 'POST',
		skipAuth: true,
		skipRetryOnUnauthorized: true,
		accountId
	});
}
