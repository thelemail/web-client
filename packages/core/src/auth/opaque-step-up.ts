import type { TwoFactorProof } from '$core/api/types';
import { keystore } from '$core/keystore/keystore-client';

export type StepUpFailure = 'password' | 'scheme';

export type StepUpOutcome<T> = { ok: true; value: T } | { ok: false; reason: StepUpFailure };

export async function opaqueStepUp<T>(args: {
	accountId: string;
	password: string;
	proof: () => Promise<TwoFactorProof | null>;
	init: (ke1: string) => Promise<{ challengeId: string; ke2: string }>;
	confirm: (challengeId: string, ke3: string, proof: TwoFactorProof | null) => Promise<T>;
}): Promise<StepUpOutcome<T>> {
	const status = await keystore.status();
	const scheme = status.accounts.find((a) => a.accountId === args.accountId)?.authScheme;
	if (scheme !== 'opaque_v1') return { ok: false, reason: 'scheme' };
	const proof = await args.proof();
	const start = await keystore.opaqueStartAuth({ password: args.password });
	try {
		const init = await args.init(start.ke1);
		const finish = await keystore.opaqueFinishAuth({
			operationId: start.operationId,
			accountId: args.accountId,
			ke2: init.ke2
		});
		if (!finish.ok) return { ok: false, reason: 'password' };
		return { ok: true, value: await args.confirm(init.challengeId, finish.ke3, proof) };
	} finally {
		keystore.opaqueAbandonOperation({ operationId: start.operationId }).catch(() => {});
	}
}
