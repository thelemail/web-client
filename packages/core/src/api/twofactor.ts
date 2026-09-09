import { apiFetch } from './client';
import type {
	TwoFactorProof,
	TwoFactorStatus,
	TwoFactorVerifyResponse,
	TwoFactorWebauthnCredential
} from './types';

const P = {
	totpVerify: '/v1/auth/2fa/totp/verify',
	webauthnInit: '/v1/auth/2fa/webauthn/init',
	webauthnVerify: '/v1/auth/2fa/webauthn/verify',
	backupCodeVerify: '/v1/auth/2fa/backup-code/verify',
	status: '/v1/2fa',
	totpEnrollInit: '/v1/2fa/totp/init',
	totpActivate: '/v1/2fa/totp/activate',
	totpDisable: '/v1/2fa/totp/disable',
	webauthnEnrollInit: '/v1/2fa/webauthn/init',
	webauthnActivate: '/v1/2fa/webauthn/activate',
	webauthnDelete: (id: string) => `/v1/2fa/webauthn/credentials/${id}/delete`,
	webauthnProofInit: '/v1/2fa/proof/webauthn/init',
	backupCodesRegenerate: '/v1/2fa/backup-codes/regenerate'
} as const;

export function verify2faTotp(req: {
	pendingToken: string;
	code: string;
	enrollPersistentSession?: boolean;
}) {
	return apiFetch<TwoFactorVerifyResponse>(P.totpVerify, {
		method: 'POST',
		body: req,
		skipAuth: true,
		headers: { 'X-Client': 'web' }
	});
}

export function init2faWebauthn(req: { pendingToken: string }) {
	return apiFetch<{ publicKey: unknown }>(P.webauthnInit, {
		method: 'POST',
		body: req,
		skipAuth: true
	});
}

export function verify2faWebauthn(req: {
	pendingToken: string;
	credential: unknown;
	enrollPersistentSession?: boolean;
}) {
	return apiFetch<TwoFactorVerifyResponse>(P.webauthnVerify, {
		method: 'POST',
		body: req,
		skipAuth: true,
		headers: { 'X-Client': 'web' }
	});
}

export function verify2faBackupCode(req: {
	pendingToken: string;
	code: string;
	enrollPersistentSession?: boolean;
}) {
	return apiFetch<TwoFactorVerifyResponse>(P.backupCodeVerify, {
		method: 'POST',
		body: req,
		skipAuth: true,
		headers: { 'X-Client': 'web' }
	});
}

export function getTwoFactorStatus(accountId?: string) {
	return apiFetch<TwoFactorStatus>(P.status, { method: 'GET', accountId });
}

export function totpEnrollInit(accountId?: string) {
	return apiFetch<{ otpauthUrl: string; qrPngBase64: string }>(P.totpEnrollInit, {
		method: 'POST',
		accountId
	});
}

export function totpActivate(req: { code: string }, accountId?: string) {
	return apiFetch<{ backupCodes?: string[] }>(P.totpActivate, {
		method: 'POST',
		body: req,
		accountId
	});
}

export function totpDisable(proof: TwoFactorProof, accountId?: string) {
	return apiFetch<void>(P.totpDisable, { method: 'POST', body: { proof }, accountId });
}

export function webauthnEnrollInit(accountId?: string) {
	return apiFetch<{ registrationId: string; publicKey: unknown }>(P.webauthnEnrollInit, {
		method: 'POST',
		accountId
	});
}

export function webauthnActivate(
	req: { registrationId: string; credential: unknown; name: string },
	accountId?: string
) {
	return apiFetch<{
		credential: TwoFactorWebauthnCredential;
		backupCodes?: string[];
	}>(P.webauthnActivate, { method: 'POST', body: req, accountId });
}

export function webauthnDelete(id: string, proof: TwoFactorProof, accountId?: string) {
	return apiFetch<void>(P.webauthnDelete(id), { method: 'POST', body: { proof }, accountId });
}

export function webauthnProofInit(accountId?: string) {
	return apiFetch<{ registrationId: string; publicKey: unknown }>(P.webauthnProofInit, {
		method: 'POST',
		accountId
	});
}

export function regenerateBackupCodes(proof: TwoFactorProof, accountId?: string) {
	return apiFetch<{ backupCodes?: string[] }>(P.backupCodesRegenerate, {
		method: 'POST',
		body: { proof },
		accountId
	});
}
