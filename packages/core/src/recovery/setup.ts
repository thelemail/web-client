import {
	getModulus,
	recoveryOpaqueRegistrationInit,
	recoverySetup,
	recoverySetupOpaque
} from '$core/api/auth';
import { keystore } from '$core/keystore/keystore-client';

export interface SrpRecoveryMaterial {
	scheme: 'srp_v1';
	phrase: string[];
	srpSalt: string;
	srpVerifier: string;
	keySalt: string;
	encryptedPrivateKey: string;
}

export interface OpaqueRecoveryMaterial {
	scheme: 'opaque_v1';
	phrase: string[];
	opaqueRecord: string;
	wrappedMasterKey: string;
	masterKeyId: string;
	opaqueParamsVersion: number;
}

export type RecoveryMaterial = SrpRecoveryMaterial | OpaqueRecoveryMaterial;

export class RecoveryVaultLockedError extends Error {
	constructor() {
		super('recovery: vault locked');
		this.name = 'RecoveryVaultLockedError';
	}
}

async function prepareSrp(accountId: string): Promise<SrpRecoveryMaterial> {
	const { modulus } = await getModulus();
	const res = await keystore.prepareRecoverySetup({ accountId, modulus });
	if (!res.ok) throw new RecoveryVaultLockedError();
	return {
		scheme: 'srp_v1',
		phrase: res.phrase.split(' '),
		srpSalt: res.srpSalt,
		srpVerifier: res.srpVerifier,
		keySalt: res.keySalt,
		encryptedPrivateKey: res.encryptedPrivateKey
	};
}

async function prepareOpaque(accountId: string): Promise<OpaqueRecoveryMaterial> {
	const start = await keystore.opaqueRecoverySetupStart({ accountId });
	if (!start.ok) throw new RecoveryVaultLockedError();
	const init = await recoveryOpaqueRegistrationInit(
		{ registrationRequest: start.registrationRequest },
		accountId
	);
	const finish = await keystore.opaqueRecoverySetupFinish({
		accountId,
		operationId: start.operationId,
		registrationResponse: init.registrationResponse
	});
	if (!finish.ok) throw new Error('recovery: opaque registration did not finish');
	return {
		scheme: 'opaque_v1',
		phrase: start.phrase.split(' '),
		opaqueRecord: finish.opaqueRecord,
		wrappedMasterKey: finish.wrappedMasterKey,
		masterKeyId: finish.masterKeyId,
		opaqueParamsVersion: finish.opaqueParamsVersion
	};
}

export async function prepareRecovery(accountId: string): Promise<RecoveryMaterial> {
	const status = await keystore.status();
	const scheme = status.accounts.find((a) => a.accountId === accountId)?.authScheme ?? 'srp_v1';
	return scheme === 'opaque_v1' ? prepareOpaque(accountId) : prepareSrp(accountId);
}

export async function commitRecovery(material: RecoveryMaterial, accountId: string): Promise<void> {
	if (material.scheme === 'opaque_v1') {
		await recoverySetupOpaque(
			{
				opaqueRecord: material.opaqueRecord,
				wrappedMasterKey: material.wrappedMasterKey,
				masterKeyId: material.masterKeyId,
				opaqueParamsVersion: material.opaqueParamsVersion
			},
			accountId
		);
		return;
	}
	await recoverySetup(
		{
			srpSalt: material.srpSalt,
			srpVerifier: material.srpVerifier,
			keySalt: material.keySalt,
			encryptedPrivateKey: material.encryptedPrivateKey,
			kdfParamsVersion: 1,
			srpParamsVersion: 1
		},
		accountId
	);
}
