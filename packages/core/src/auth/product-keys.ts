import type { CryptoAccountHead, CryptoStateResponse, ProductKeysProduct } from '$core/api/productKeys';
import {
	activateCryptoHead,
	getCryptoState,
	getProductBundle,
	getProductKeys,
	getSecretBundle,
	putProductBundle,
	putProductManifest,
	putSecretBundle
} from '$core/api/productKeys';
import { listMyKeys } from '$core/api/me';
import type { AliasKeyGrant } from '$core/api/aliases';
import { listMyAliasKeys } from '$core/api/aliases';
import type { AccountKeyListResponse } from '$core/api/types';
import { b64ToText } from '$core/keys/encode';
import type { PrepareProductKeysArgs } from '$core/keystore/protocol';
import { keystore } from '$core/keystore/keystore-client';
import { b64decode, b64encode } from '$core/keystore/productkeys/encoding';
import { parseHeadV2 } from '$core/keystore/productkeys/head';
import { parseIdentityManifest } from '$core/keystore/productkeys/manifests';
import type { Availability } from '$core/keystore/productkeys/productBundle';
import type { ProductReadInput, ReadResult, StoredBundle } from '$core/keystore/productkeys/read';

export type ProductKeysOutcome =
	| { status: 'disabled' | 'unsupported' | 'locked' }
	| { status: 'activated' | 'active'; result: ReadResult };

const PRODUCTS: ProductKeysProduct[] = ['app', 'calendar'];

async function loadState(accountId: string): Promise<{ state: CryptoStateResponse; events: Uint8Array[] }> {
	const state = await getCryptoState(accountId);
	const events = state.history.events.map(b64decode);
	let cursor = state.history.nextCursor;
	while (cursor) {
		const page = await getCryptoState(accountId, cursor);
		events.push(...page.history.events.map(b64decode));
		cursor = page.history.nextCursor;
	}
	return { state, events };
}

function opt(s: string | null): Uint8Array | null {
	return s ? b64decode(s) : null;
}

export function conversionArgs(
	accountId: string,
	state: CryptoStateResponse,
	events: Uint8Array[],
	keys: AccountKeyListResponse,
	aliases: AliasKeyGrant[]
): PrepareProductKeysArgs {
	return {
		accountId,
		scope: { ...state.scope, keyHistoryRoot: b64decode(state.scope.keyHistoryRoot) },
		sessionEpoch: state.sessionEpoch,
		previousHeadHash: state.head?.version === 1 ? b64decode(state.head.headHash) : null,
		credentialHashes: state.credentials.filter((c) => c.state === 'active' && c.recordHash).map((c) => b64decode(c.recordHash!)),
		slotHashes: state.slots.filter((s) => s.state === 'active').map((s) => b64decode(s.wrapperHash)),
		historyEvents: events,
		availability: state.keys.map((k) => ({ keyId: k.keyId, state: k.privateState as Availability })),
		accountKeys: keys.keys.map((k) => ({ armoredEncrypted: k.encryptedPrivateKey || null, isCurrent: k.isCurrent })),
		aliasKeys: aliases.map((g) => ({ aliasId: g.aliasAccountId, keyVersion: g.keyVersion, wrappedPrivateKey: b64ToText(g.wrappedPrivateKey) }))
	};
}

async function convert(accountId: string, state: CryptoStateResponse, events: Uint8Array[]): Promise<ProductKeysOutcome | null> {
	const [keys, aliases] = await Promise.all([listMyKeys(accountId), listMyAliasKeys(accountId)]);
	const prepared = await keystore.prepareProductKeys(conversionArgs(accountId, state, events, keys, aliases.keys));
	if (!prepared.ok) {
		if (prepared.code === 'invalid') throw new Error(prepared.message ?? 'product keys: conversion refused');
		return { status: prepared.code };
	}
	const out = prepared.output;
	for (const b of out.secretBundles) await putSecretBundle(accountId, b.bundleId, b.revision, b.kind, b64encode(b.bundle));
	for (const b of out.productBundles) await putProductBundle(accountId, b.product, b.bundleId, b.revision, b64encode(b.bundle));
	for (const m of out.identityManifests) {
		await putProductManifest(accountId, m.product, m.kind, m.revision, m.page, b64encode(m.record), b64encode(m.signature));
	}
	await activateCryptoHead(accountId, {
		head: b64encode(out.activation.head),
		mac: b64encode(out.activation.mac),
		authoritySignature: b64encode(out.activation.authoritySignature),
		legacySignature: b64encode(out.activation.legacySignature),
		transitionSignature: null,
		authorityPublicKey: b64encode(out.activation.authorityPublicKey),
		delegations: out.activation.delegations.map((d) => ({
			record: b64encode(d.record),
			signature: b64encode(d.signature),
			signingPublicKey: b64encode(d.signingPublicKey),
			recipientPublicKey: b64encode(d.recipientPublicKey)
		}))
	});
	for (const m of out.dataManifests) {
		await putProductManifest(accountId, m.product, m.kind, m.revision, m.page, b64encode(m.record), b64encode(m.signature));
	}
	return null;
}

export async function readProductKeys(accountId: string, state?: CryptoStateResponse): Promise<ProductKeysOutcome> {
	const current = state ?? (await getCryptoState(accountId));
	const head: CryptoAccountHead | null = current.head;
	if (!head || head.version !== 2) throw new Error('product keys: no active head');
	const raw = b64decode(head.head);
	const parsed = parseHeadV2(raw);
	const committed = new Set(parsed.bundleDescriptorHashes.map(b64encode));
	const secretBundles: StoredBundle[] = [];
	for (const b of current.bundles) {
		if (!committed.has(b.bytesHash)) continue;
		const got = await getSecretBundle(accountId, b.bundleId, b.bundleRevision);
		secretBundles.push({ bundleId: got.bundleId, revision: got.bundleRevision, bundle: b64decode(got.bundle) });
	}
	let authorityKey: Uint8Array | null = null;
	const products: ProductReadInput[] = [];
	for (const product of PRODUCTS) {
		const view = await getProductKeys(accountId, product);
		if (!view.identityManifest || !view.delegation || !view.authorityKey) throw new Error(`product keys: ${product} is incomplete`);
		authorityKey = b64decode(view.authorityKey.publicKey);
		const record = b64decode(view.identityManifest.record);
		const bundles: StoredBundle[] = [];
		for (const ref of parseIdentityManifest(record).bundles) {
			const got = await getProductBundle(accountId, product, ref.bundleId, ref.revision);
			bundles.push({ bundleId: ref.bundleId, revision: ref.revision, bundle: b64decode(got.bundle) });
		}
		products.push({
			product,
			identityManifest: { record, signature: b64decode(view.identityManifest.signature) },
			delegation: {
				record: b64decode(view.delegation.record),
				signature: b64decode(view.delegation.signature),
				signingPublicKey: b64decode(view.delegation.signingPublicKey)
			},
			dataManifest: view.dataManifest.map((p) => ({ record: b64decode(p.record), signature: b64decode(p.signature) })),
			bundles
		});
	}
	const published = await listMyKeys(accountId);
	const read = await keystore.readProductKeys({
		accountId,
		mailPublicKeysArmored: published.keys.map((k) => k.publicKeyArmored).filter(Boolean),
		authorityKey: authorityKey!,
		head: {
			raw,
			mac: b64decode(head.mac),
			previousHeadHash: opt(head.previousHeadHash),
			authority: opt(head.authoritySignature),
			legacy: opt(head.legacySignature),
			transition: opt(head.transitionSignature)
		},
		secretBundles,
		products
	});
	if (!read.ok) {
		if (read.code === 'invalid') throw new Error(read.message ?? 'product keys: read-back failed');
		return { status: read.code };
	}
	return { status: 'active', result: read.result };
}

export async function ensureProductKeys(accountId: string): Promise<ProductKeysOutcome> {
	const { state, events } = await loadState(accountId);
	if (!state.features.productKeys) return { status: 'disabled' };
	if (state.head?.version === 2) return readProductKeys(accountId, state);
	const refused = await convert(accountId, state, events);
	if (refused) return refused;
	const read = await readProductKeys(accountId);
	return read.status === 'active' ? { status: 'activated', result: read.result } : read;
}
