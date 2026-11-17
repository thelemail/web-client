import type { CryptoAccountHead, CryptoStateResponse, ProductKeysProduct } from '$core/api/productKeys';
import {
	activateCryptoHead,
	getCryptoState,
	getProductBundle,
	getProductCandidate,
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
import { ApiCallError } from '$core/api/types';
import { b64ToText } from '$core/keys/encode';
import type { PrepareProductKeysArgs } from '$core/keystore/protocol';
import { keystore } from '$core/keystore/keystore-client';
import { b64decode, b64encode } from '$core/keystore/productkeys/encoding';
import { parseCandidate } from '$core/keystore/productkeys/candidate';
import { parseHeadV2 } from '$core/keystore/productkeys/head';
import type { StoredCandidate } from '$core/keystore/productkeys/mailCandidate';
import { parseIdentityManifest } from '$core/keystore/productkeys/manifests';
import type { Availability } from '$core/keystore/productkeys/productBundle';
import type { ProductReadInput, ReadResult, StoredBundle } from '$core/keystore/productkeys/read';

export type ProductKeysOutcome =
	| { status: 'disabled' | 'unsupported' | 'locked' }
	| { status: 'activated' | 'active'; result: ReadResult };

const PRODUCTS: ProductKeysProduct[] = ['app', 'calendar'];

export async function loadCryptoState(accountId: string): Promise<{ state: CryptoStateResponse; events: Uint8Array[] }> {
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

export async function storedMailCandidate(accountId: string): Promise<StoredCandidate | null> {
	let found;
	try {
		found = await getProductCandidate(accountId, 'app');
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 404) return null;
		throw err;
	}
	const record = b64decode(found.record);
	const bundles: StoredBundle[] = [];
	for (const ref of parseCandidate(record).bundles) {
		const got = await getProductBundle(accountId, 'app', ref.bundleId, ref.revision);
		bundles.push({ bundleId: ref.bundleId, revision: ref.revision, bundle: b64decode(got.bundle) });
	}
	return { record, rootBundle: b64decode(found.rootBundle), bundles };
}

async function convert(accountId: string, state: CryptoStateResponse, events: Uint8Array[]): Promise<ProductKeysOutcome | null> {
	const [keys, aliases, candidate] = await Promise.all([listMyKeys(accountId), listMyAliasKeys(accountId), storedMailCandidate(accountId)]);
	const prepared = await keystore.prepareProductKeys({
		...conversionArgs(accountId, state, events, keys, aliases.keys),
		...(candidate ? { candidate } : {})
	});
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

interface Committed {
	head: CryptoAccountHead;
	raw: Uint8Array;
	authorityKey: Uint8Array;
	secretBundles: StoredBundle[];
	products: ProductReadInput[];
}

async function loadCommitted(accountId: string, state: CryptoStateResponse): Promise<Committed> {
	const head = state.head;
	if (!head || head.version !== 2) throw new Error('product keys: no active head');
	const raw = b64decode(head.head);
	const parsed = parseHeadV2(raw);
	const committed = new Set(parsed.bundleDescriptorHashes.map(b64encode));
	const secretBundles: StoredBundle[] = [];
	for (const b of state.bundles) {
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
	return { head, raw, authorityKey: authorityKey!, secretBundles, products };
}

async function readCommitted(accountId: string, c: Committed): Promise<ProductKeysOutcome> {
	const published = await listMyKeys(accountId);
	const read = await keystore.readProductKeys({
		accountId,
		mailPublicKeysArmored: published.keys.map((k) => k.publicKeyArmored).filter(Boolean),
		authorityKey: c.authorityKey,
		head: {
			raw: c.raw,
			mac: b64decode(c.head.mac),
			previousHeadHash: opt(c.head.previousHeadHash),
			authority: opt(c.head.authoritySignature),
			legacy: opt(c.head.legacySignature),
			transition: opt(c.head.transitionSignature)
		},
		secretBundles: c.secretBundles,
		products: c.products
	});
	if (!read.ok) {
		if (read.code === 'invalid') throw new Error(read.message ?? 'product keys: read-back failed');
		return { status: read.code };
	}
	return { status: 'active', result: read.result };
}

export async function readProductKeys(accountId: string, state?: CryptoStateResponse): Promise<ProductKeysOutcome> {
	const current = state ?? (await getCryptoState(accountId));
	return readCommitted(accountId, await loadCommitted(accountId, current));
}

const hashSet = (hashes: (string | null)[]) => [...hashes].filter((h): h is string => !!h).sort().join(',');

export function headDrift(state: CryptoStateResponse, raw: Uint8Array, appManifest: Uint8Array, aliases: AliasKeyGrant[]): boolean {
	const head = parseHeadV2(raw);
	const s = state.scope;
	if (
		head.stateRevision !== s.stateRevision ||
		head.authEpoch !== s.authEpoch ||
		head.recoveryEpoch !== s.recoveryEpoch ||
		head.keyEpoch !== s.activeKeyEpoch ||
		head.cryptoGeneration !== s.activeGeneration ||
		head.minimumWriteProfile !== s.minimumWriteProfile ||
		head.historyEventCount !== s.historyEventCount ||
		head.observedSessionEpoch !== state.sessionEpoch ||
		b64encode(head.keyHistoryRoot) !== s.keyHistoryRoot
	) {
		return true;
	}
	if (hashSet(head.credentialDescriptorHashes.map(b64encode)) !== hashSet(state.credentials.filter((c) => c.state === 'active').map((c) => c.recordHash))) return true;
	if (hashSet(head.slotDescriptorHashes.map(b64encode)) !== hashSet(state.slots.filter((x) => x.state === 'active').map((x) => x.wrapperHash))) return true;
	const committed = parseIdentityManifest(appManifest)
		.identityKeys.filter((k) => k.usage === 'mail-alias')
		.map((k) => k.keyEpoch)
		.sort((a, b) => a - b);
	const granted = aliases.map((g) => g.keyVersion).sort((a, b) => a - b);
	return committed.join(',') !== granted.join(',');
}

async function succeed(accountId: string, state: CryptoStateResponse, events: Uint8Array[], c: Committed): Promise<boolean> {
	const app = c.products.find((p) => p.product === 'app')!;
	const [keys, aliases] = await Promise.all([listMyKeys(accountId), listMyAliasKeys(accountId)]);
	if (!headDrift(state, c.raw, app.identityManifest.record, aliases.keys)) return false;
	const { previousHeadHash: _, ...args } = conversionArgs(accountId, state, events, keys, aliases.keys);
	const prepared = await keystore.prepareSuccessorHead({
		...args,
		previous: { raw: c.raw, mac: b64decode(c.head.mac) },
		secretBundles: c.secretBundles,
		products: c.products
	});
	if (!prepared.ok) {
		if (prepared.code === 'invalid') throw new Error(prepared.message ?? 'product keys: successor refused');
		return false;
	}
	const out = prepared.output;
	if (!out) return false;
	for (const b of out.secretBundles) await putSecretBundle(accountId, b.bundleId, b.revision, b.kind, b64encode(b.bundle));
	for (const b of out.productBundles) await putProductBundle(accountId, b.product, b.bundleId, b.revision, b64encode(b.bundle));
	for (const m of out.identityManifests) {
		await putProductManifest(accountId, m.product, m.kind, m.revision, m.page, b64encode(m.record), b64encode(m.signature));
	}
	await activateCryptoHead(accountId, {
		head: b64encode(out.activation.head),
		mac: b64encode(out.activation.mac),
		authoritySignature: b64encode(out.activation.authoritySignature),
		legacySignature: null,
		transitionSignature: null,
		authorityPublicKey: null,
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
	return true;
}

async function current(accountId: string, state: CryptoStateResponse, events: Uint8Array[]): Promise<Committed | null> {
	try {
		const committed = await loadCommitted(accountId, state);
		return (await succeed(accountId, state, events, committed)) ? null : committed;
	} catch (err) {
		console.warn('product keys: successor head failed', err);
		return null;
	}
}

export async function ensureProductKeys(accountId: string): Promise<ProductKeysOutcome> {
	const { state, events } = await loadCryptoState(accountId);
	if (!state.features.productKeys) return { status: 'disabled' };
	if (state.head?.version === 2) {
		const committed = await current(accountId, state, events);
		return committed ? readCommitted(accountId, committed) : readProductKeys(accountId);
	}
	const refused = await convert(accountId, state, events);
	if (refused) return refused;
	const read = await readProductKeys(accountId);
	return read.status === 'active' ? { status: 'activated', result: read.result } : read;
}

export async function ensureConverted(accountId: string): Promise<boolean> {
	const { state, events } = await loadCryptoState(accountId);
	if (!state.features.productKeys) return false;
	if (state.head?.version === 2) {
		await current(accountId, state, events);
		return true;
	}
	if (await convert(accountId, state, events)) return false;
	return (await readProductKeys(accountId)).status === 'active';
}
