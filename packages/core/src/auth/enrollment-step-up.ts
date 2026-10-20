import { stepUpOpaqueConfirm, stepUpOpaqueInit } from '$core/api/twofactor';
import type { EnrollmentAction, TwoFactorProof } from '$core/api/types';
import { opaqueStepUp, type StepUpFailure } from './opaque-step-up';

export type EnrollmentStepUpResult =
	| { ok: true; grant: string }
	| { ok: false; reason: StepUpFailure };

export async function enrollmentStepUp(args: {
	accountId: string;
	password: string;
	action: EnrollmentAction;
	proof: () => Promise<TwoFactorProof | null>;
}): Promise<EnrollmentStepUpResult> {
	const res = await opaqueStepUp({
		accountId: args.accountId,
		password: args.password,
		proof: args.proof,
		init: (ke1) => stepUpOpaqueInit({ ke1, action: args.action }, args.accountId),
		confirm: (challengeId, ke3, proof) =>
			stepUpOpaqueConfirm(
				{ challengeId, ke3, action: args.action, ...(proof ? { proof } : {}) },
				args.accountId
			)
	});
	return res.ok ? { ok: true, grant: res.value.grant } : res;
}
