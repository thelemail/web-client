import { webauthnProofInit } from '$core/api/twofactor';
import type { TwoFactorMethod, TwoFactorProof, TwoFactorStatus } from '$core/api/types';
import { getAssertion } from '$core/auth/webauthn';

export function enrolledMethods(status: TwoFactorStatus | null): TwoFactorMethod[] {
	if (!status) return [];
	const out: TwoFactorMethod[] = [];
	if (status.webauthnCredentials.length > 0) out.push('webauthn');
	if (status.totp?.active) out.push('totp');
	if ((status.backupCodes?.remaining ?? 0) > 0) out.push('backupCode');
	return out;
}

export function codeProof(mode: 'totp' | 'backup', code: string): TwoFactorProof {
	return mode === 'totp' ? { method: 'totp', code } : { method: 'backupCode', code: code.trim() };
}

export async function webauthnProof(accountId?: string): Promise<TwoFactorProof> {
	const init = await webauthnProofInit(accountId);
	const credential = await getAssertion(init.publicKey);
	return { method: 'webauthn', proofToken: init.registrationId, credential };
}
