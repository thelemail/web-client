import { sessionStepUpConfirm, sessionStepUpInit } from '$core/api/auth';
import type { RefreshResponse, TwoFactorProof } from '$core/api/types';
import { opaqueStepUp, type StepUpFailure } from './opaque-step-up';

export type SessionStepUpResult =
	| { ok: true; session: RefreshResponse }
	| { ok: false; reason: StepUpFailure };

export async function sessionStepUp(args: {
	accountId: string;
	password: string;
	proof: () => Promise<TwoFactorProof | null>;
}): Promise<SessionStepUpResult> {
	const res = await opaqueStepUp({
		accountId: args.accountId,
		password: args.password,
		init: (ke1) => sessionStepUpInit({ ke1 }, args.accountId),
		confirm: async (challengeId, ke3) => {
			const proof = await args.proof();
			return sessionStepUpConfirm({ challengeId, ke3, ...(proof ? { proof } : {}) }, args.accountId);
		}
	});
	return res.ok ? { ok: true, session: res.value } : res;
}
