import * as openpgp from 'openpgp';

import type { ReadDelegate } from '$core/api/types';
import { lookupAccount } from '$core/api/accounts';
import {
	canonicaliseReadDelegation,
	parseReadDelegationStatement,
	READ_DELEGATION_PERMISSION,
	ReadDelegationVerificationError,
	type ReadDelegationStatement
} from './read-delegation-statement';
import {
	DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX,
	DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED
} from './signing-key';
import { TLOG_POLICY, type TlogRuntimePolicy } from './tlog/policy';
import { tlogStateStore } from './tlog/state-idb';
import { verifyTlogProof } from './tlog/verify-tlog';

export * from './read-delegation-statement';

function base64ToBytes(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

function fingerprintHex(key: openpgp.Key): string {
	const fp = key.getFingerprint();
	if (typeof fp === 'string') return fp.toLowerCase();
	return Array.from(new Uint8Array(fp as ArrayLike<number>), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface VerifyReadDelegateOptions {
	tlogPolicy?: TlogRuntimePolicy | null;
	nowMillis?: number;
}

export async function verifyReadDelegate(
	delegate: ReadDelegate,
	requestedAddress: string,
	opts: VerifyReadDelegateOptions = {}
): Promise<ReadDelegationStatement> {
	const address = requestedAddress.trim().toLowerCase();
	const raw = base64ToBytes(delegate.statement);
	const statement = parseReadDelegationStatement(raw);

	if (
		statement.signingKeyFingerprint.toLowerCase() !==
		DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase()
	) {
		throw new ReadDelegationVerificationError(
			'signing_key_mismatch',
			'read delegation was signed by an unknown directory key'
		);
	}
	if (statement.address.toLowerCase() !== address) {
		throw new ReadDelegationVerificationError('address_mismatch', 'read delegation is for a different address');
	}
	if (statement.readDelegationId !== delegate.id) {
		throw new ReadDelegationVerificationError('delegation_mismatch', 'statement names a different read delegation');
	}
	if (statement.revokedAt !== null) {
		throw new ReadDelegationVerificationError('revoked', 'read delegation is revoked');
	}
	if (statement.permissions.length !== 1 || statement.permissions[0] !== READ_DELEGATION_PERMISSION) {
		throw new ReadDelegationVerificationError('permission_mismatch', 'read delegation grants an unexpected permission');
	}

	const key = await openpgp.readKey({ armoredKey: delegate.publicKeyArmored });
	if (key.isPrivate()) {
		throw new ReadDelegationVerificationError('not_encryption_only', 'read delegation key carries secret material');
	}
	if (fingerprintHex(key) !== statement.encryptionKeyFingerprint.toLowerCase()) {
		throw new ReadDelegationVerificationError(
			'fingerprint_mismatch',
			'the published key does not match the signed statement'
		);
	}
	const subkeys = key.getSubkeys();
	if (subkeys.length !== 1) {
		throw new ReadDelegationVerificationError('not_encryption_only', 'read delegation key must have one subkey');
	}
	for (const sub of subkeys) {
		const flags = sub.bindingSignatures[0]?.keyFlags?.[0] ?? 0;
		if ((flags & openpgp.enums.keyFlags.signData) !== 0) {
			throw new ReadDelegationVerificationError('not_encryption_only', 'read delegation subkey can sign');
		}
	}
	const users = key.getUserIDs();
	const boundTo = users[0]?.toLowerCase() ?? '';
	if (users.length !== 1 || (!boundTo.includes(`<${address}>`) && boundTo !== address)) {
		throw new ReadDelegationVerificationError('address_mismatch', 'read delegation key is bound to another address');
	}
	try {
		await key.getEncryptionKey();
	} catch {
		throw new ReadDelegationVerificationError('not_encryption_only', 'read delegation key cannot encrypt');
	}

	const signingKey = await openpgp.readKey({ armoredKey: DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED });
	const signature = await openpgp.readSignature({
		binarySignature: base64ToBytes(delegate.statementSignature)
	});
	const canonical = canonicaliseReadDelegation(statement);
	const message = await openpgp.createMessage({ binary: canonical });
	const result = await openpgp.verify({
		message,
		signature,
		verificationKeys: signingKey as openpgp.PublicKey
	});
	try {
		await result.signatures[0].verified;
	} catch {
		throw new ReadDelegationVerificationError('signature_invalid', 'the read delegation signature did not verify');
	}

	const policy = opts.tlogPolicy === undefined ? TLOG_POLICY : opts.tlogPolicy;
	if (policy) {
		try {
			await verifyTlogProof(delegate.tlogProof, canonical, address, policy, {
				nowMillis: opts.nowMillis ?? Date.now(),
				store: tlogStateStore,
				refetchConsistency: async (since) => (await lookupAccount(address, since)).tlogConsistency
			});
		} catch (e) {
			if (policy.mode === 'enforce') throw e;
		}
	}
	return statement;
}
