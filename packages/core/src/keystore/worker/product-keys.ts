import * as openpgp from 'openpgp';
import type {
	PrepareProductKeysArgs,
	PrepareProductKeysResponse,
	ReadProductKeysArgs,
	ReadProductKeysResponse,
	SealProductHandoffArgs,
	SealProductHandoffResponse
} from '../protocol';
import { sealHandoff } from '../handoff/envelope';
import { parseGrant } from '../handoff/wire';
import { buildConversion, historyKeys } from '../productkeys/convert';
import { bytesEqual, sha256 } from '../productkeys/encoding';
import { fail, ProductKeysError } from '../productkeys/errors';
import { headHash, parseHeadV2, verifyHeadMac } from '../productkeys/head';
import { openMailCandidate, wipeOpenedMailKeys } from '../productkeys/mailCandidate';
import { openAuthority, openRootDescriptor } from '../productkeys/secretBundle';
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
	let adopted: Uint8Array | undefined;
	try {
		if (args.candidate) {
			const opened = await openMailCandidate(args.accountId, v.masterKey!, v.keyPassword, args.candidate);
			adopted = opened.root.slice();
			wipeOpenedMailKeys(opened);
		}
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
			aliasKeys: args.aliasKeys,
			...(adopted ? { appRoot: adopted } : {})
		});
		return { ok: true, output };
	} catch (err) {
		if (err instanceof ProductKeysError) return { ok: false, code: 'invalid', message: err.message };
		throw err;
	} finally {
		adopted?.fill(0);
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

export async function handleSealProductHandoff(args: SealProductHandoffArgs): Promise<SealProductHandoffResponse> {
	const refused = unusable(args.accountId);
	if (refused) return refused;
	const amk = vaults.get(args.accountId)!.masterKey!;
	try {
		await verifyHeadMac(amk, args.accountId, args.head.raw, args.head.mac);
		const head = parseHeadV2(args.head.raw);
		const grant = parseGrant(args.grant);
		if (grant.accountId !== args.accountId || head.accountId !== args.accountId) fail('context', 'grant names another account');
		if (grant.accountHeadRevision !== head.stateRevision || !bytesEqual(grant.accountHeadHash, await headHash(args.head.raw))) {
			fail('context', 'grant names another head');
		}
		if (grant.authorityEpoch !== head.authorityEpoch) fail('context', 'authority epoch');
		const d = head.productDescriptors.find((x) => x.product === grant.product);
		if (!d) fail('context', 'product is not committed');
		const committed = new Set(head.bundleDescriptorHashes.map((h) => h.join(',')));
		const rootBundle = args.secretBundles.find((b) => b.bundleId === d.rootBundleId && b.revision === d.rootBundleRevision);
		if (!rootBundle || !bytesEqual(await sha256(rootBundle.bundle), d.rootBundleCiphertextHash)) fail('context', 'root descriptor');
		const root = await openRootDescriptor(amk, rootBundle.bundle, {
			accountId: args.accountId,
			amkEpoch: head.amkEpoch,
			bundleId: d.rootBundleId,
			revision: d.rootBundleRevision
		});
		try {
			if (
				root.product !== grant.product ||
				root.productKeyEpoch !== d.productKeyEpoch ||
				grant.productKeyEpoch !== d.productKeyEpoch ||
				root.identityManifestId !== d.identityManifestId ||
				grant.manifestId !== d.identityManifestId ||
				root.identityManifestRevision !== d.identityManifestRevision ||
				grant.manifestRevision !== d.identityManifestRevision ||
				!bytesEqual(root.identityManifestHash, d.identityManifestHash) ||
				!bytesEqual(grant.manifestHash, d.identityManifestHash)
			) {
				fail('context', 'grant does not match the committed product');
			}
			let signer: openpgp.PrivateKey | null = null;
			for (const b of args.secretBundles) {
				if (!committed.has((await sha256(b.bundle)).join(','))) continue;
				try {
					const a = await openAuthority(amk, b.bundle, { accountId: args.accountId, amkEpoch: head.amkEpoch, bundleId: b.bundleId, revision: b.revision });
					if (a.authorityKeyId !== head.authorityKeyId || a.authorityEpoch !== head.authorityEpoch) continue;
					signer = await openpgp.readPrivateKey({ binaryKey: a.secretKey.slice() });
					a.secretKey.fill(0);
					break;
				} catch (err) {
					if ((err as { code?: string }).code !== 'context') throw err;
				}
			}
			if (!signer) fail('context', 'authority bundle is missing');
			return { ok: true, envelope: await sealHandoff(grant, root.productRoot, args.receiverPublicKey, signer) };
		} finally {
			root.productRoot.fill(0);
		}
	} catch (err) {
		if (err instanceof ProductKeysError) return { ok: false, code: 'invalid', message: err.message };
		throw err;
	}
}
