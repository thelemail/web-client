import * as openpgp from 'openpgp';
import type {
	PrepareProductKeysArgs,
	PrepareProductKeysResponse,
	ReadProductKeysArgs,
	ReadProductKeysResponse
} from '../protocol';
import { buildConversion, historyKeys } from '../productkeys/convert';
import { ProductKeysError } from '../productkeys/errors';
import type { Availability } from '../productkeys/productBundle';
import { readProductKeys } from '../productkeys/read';
import { vaults } from './state';

function unusable(accountId: string): { ok: false; code: 'locked' | 'unsupported' } | null {
	const v = vaults.get(accountId);
	if (!v) return { ok: false, code: 'locked' };
	if (v.authScheme !== 'opaque_v1' || !v.masterKey) return { ok: false, code: 'unsupported' };
	return null;
}

export async function handlePrepareProductKeys(args: PrepareProductKeysArgs): Promise<PrepareProductKeysResponse> {
	const refused = unusable(args.accountId);
	if (refused) return refused;
	const v = vaults.get(args.accountId)!;
	try {
		const output = await buildConversion({
			accountId: args.accountId,
			amk: v.masterKey!,
			keyPassword: v.keyPassword,
			scope: args.scope,
			sessionEpoch: args.sessionEpoch,
			previousHeadHash: args.previousHeadHash,
			credentialHashes: args.credentialHashes,
			slotHashes: args.slotHashes,
			history: historyKeys(args.historyEvents),
			availability: new Map<string, Availability>(args.availability.map((a) => [a.keyId, a.state])),
			accountKeys: args.accountKeys,
			aliasKeys: args.aliasKeys
		});
		return { ok: true, output };
	} catch (err) {
		if (err instanceof ProductKeysError) return { ok: false, code: 'invalid', message: err.message };
		throw err;
	}
}

export async function handleReadProductKeys(args: ReadProductKeysArgs): Promise<ReadProductKeysResponse> {
	const refused = unusable(args.accountId);
	if (refused) return refused;
	const v = vaults.get(args.accountId)!;
	try {
		const { mailPublicKeysArmored, ...rest } = args;
		const mailKeys = await Promise.all(mailPublicKeysArmored.map((armoredKey) => openpgp.readKey({ armoredKey })));
		const result = await readProductKeys({
			...rest,
			amk: v.masterKey!,
			keyPassword: v.keyPassword,
			mailKeys
		});
		return { ok: true, result };
	} catch (err) {
		if (err instanceof ProductKeysError) return { ok: false, code: 'invalid', message: err.message };
		throw err;
	}
}
