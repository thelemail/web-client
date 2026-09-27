import { stepUpOpaqueConfirm, stepUpOpaqueInit } from '$core/api/twofactor';
import type { EnrollmentAction, TwoFactorProof } from '$core/api/types';
import { keystore } from '$core/keystore/keystore-client';

export type EnrollmentStepUpResult =
	| { ok: true; grant: string }
	| { ok: false; reason: 'password' | 'scheme' };

export async function enrollmentStepUp(args: {
	accountId: string;
	password: string;
	action: EnrollmentAction;
	proof: () => Promise<TwoFactorProof | null>;
}): Promise<EnrollmentStepUpResult> {
	const status = await keystore.status();
	const scheme = status.accounts.find((a) => a.accountId === args.accountId)?.authScheme;
	if (scheme !== 'opaque_v1') return { ok: false, reason: 'scheme' };
	const start = await keystore.opaqueStartAuth({ password: args.password });
	const init = await stepUpOpaqueInit({ ke1: start.ke1, action: args.action }, args.accountId);
	const finish = await keystore.opaqueFinishAuth({
		operationId: start.operationId,
		accountId: args.accountId,
		ke2: init.ke2
	});
	if (!finish.ok) return { ok: false, reason: 'password' };
	const proof = await args.proof();
	const res = await stepUpOpaqueConfirm(
		{ challengeId: init.challengeId, ke3: finish.ke3, action: args.action, ...(proof ? { proof } : {}) },
		args.accountId
	);
	return { ok: true, grant: res.grant };
}
