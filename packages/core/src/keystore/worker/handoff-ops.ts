/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { putVault } from '../idb';
import type { VaultRecord } from '../idb';
import { openHandoff, verifyHandoff } from '../handoff/envelope';
import { deleteStaged, getStaged, putStaged } from '../handoff/store';
import type { Context } from '../handoff/wire';
import { b64decode, bytesEqual, keyId, sha256 } from '../productkeys/encoding';
import { transcriptHash } from '../productkeys/envelope';
import { fail, ProductKeysError } from '../productkeys/errors';
import { HEAD_DOMAIN, headHash, parseHeadV2 } from '../productkeys/head';
import { DOMAIN, parseIdentityManifest } from '../productkeys/manifests';
import { fingerprintBytes, parsePublicKey, validateProfile, verifyTranscript } from '../productkeys/pgp';
import type { Entry } from '../productkeys/productBundle';
import { openProductBundle } from '../productkeys/productBundle';
import { PROFILE } from '../productkeys/profiles';
import type {
	AdoptHandoffArgs,
	AdoptHandoffResponse,
	CommitHandoffArgs,
	CommitHandoffResponse,
	HandoffExpectation
} from '../protocol';
import type { ProductVault } from './product-vault';
import { decodeProductVault, encodeProductVault, PRODUCT_VAULT_VERSION, productVaultState, wipeProductVault } from './product-vault';
import type { VaultState } from './state';
import { broadcast, cachedRecords, indexKeys, vaults } from './state';

export const PRODUCT_VAULT_WRAP_INFO = new TextEncoder().encode('thelemail-product-vault-wrap-v1');

interface PendingAdoption {
	accountId: string;
	state: VaultState;
	staged: VaultRecord | null;
	wrapKey: CryptoKey | null;
}

const pending = new Map<string, PendingAdoption>();

function sameContext(c: Context, args: AdoptHandoffArgs, expect: HandoffExpectation): boolean {
	return (
		c.accountId === args.accountId &&
		c.requestId === args.requestId &&
		c.product === args.product &&
		c.issuer === expect.issuer &&
		c.origin === expect.origin &&
		c.clientId === expect.clientId &&
		c.callback === expect.callback &&
		c.destinationSessionId === expect.destinationSessionId &&
		bytesEqual(c.receiverKeyDigest, expect.receiverKeyDigest) &&
		bytesEqual(c.stateHash, expect.stateHash)
	);
}

export async function productWrapKey(localHalfKey: CryptoKey, serverHalf: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: serverHalf as BufferSource, info: PRODUCT_VAULT_WRAP_INFO as BufferSource },
		localHalfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

async function openBundles(args: AdoptHandoffArgs, root: Uint8Array, c: Context, authority: openpgp.Key, authorityKeyId: string): Promise<Entry[]> {
	const { record, signature } = args.keys.identityManifest;
	if (!bytesEqual(await transcriptHash(DOMAIN.identityManifest, record), c.manifestHash)) fail('context', 'identity manifest hash');
	await verifyTranscript(DOMAIN.identityManifest, record, signature, authority);
	const m = parseIdentityManifest(record);
	if (
		m.accountId !== args.accountId ||
		m.product !== args.product ||
		m.productKeyEpoch !== c.productKeyEpoch ||
		m.manifestId !== c.manifestId ||
		m.revision !== c.manifestRevision ||
		m.authorityKeyId !== authorityKeyId ||
		m.authorityEpoch !== c.authorityEpoch
	) {
		fail('context', 'identity manifest does not match the grant');
	}
	const entries: Entry[] = [];
	for (const ref of m.bundles) {
		const stored = args.keys.bundles.find((b) => b.bundleId === ref.bundleId && b.revision === ref.revision);
		if (!stored || stored.bundle.length !== ref.byteLength || !bytesEqual(await sha256(stored.bundle), ref.ciphertextHash)) {
			fail('context', `bundle ${ref.bundleId}/${ref.revision}`);
		}
		entries.push(
			...(await openProductBundle(root, stored.bundle, {
				accountId: args.accountId,
				product: args.product,
				productKeyEpoch: c.productKeyEpoch,
				bundleId: ref.bundleId,
				revision: ref.revision
			}, []))
		);
	}
	for (const k of m.identityKeys) {
		const e = entries.find((x) => x.keyId === k.keyId);
		if (!e || e.availability !== k.privateAvailability || e.keyEpoch !== k.keyEpoch) fail('context', `identity key ${k.keyId}`);
	}
	return entries;
}

async function stage(args: AdoptHandoffArgs, vault: ProductVault): Promise<{ record: VaultRecord; wrapKey: CryptoKey } | null> {
	if (!args.serverHalf) return null;
	const ikm = crypto.getRandomValues(new Uint8Array(32));
	const localHalfKey = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveKey']);
	ikm.fill(0);
	const serverHalf = b64decode(args.serverHalf);
	const wrapKey = await productWrapKey(localHalfKey, serverHalf);
	const wrapIv = crypto.getRandomValues(new Uint8Array(12));
	const plain = encodeProductVault(vault);
	const wrappedPrivateKey = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv as BufferSource }, wrapKey, plain as BufferSource)
	);
	const record: VaultRecord = {
		accountId: args.accountId,
		email: args.email,
		authScheme: 'opaque_v1',
		armoredEncryptedPrivateKey: '',
		updatedAt: Date.now(),
		wrappedPrivateKey,
		wrapIv,
		wrapPayloadVersion: PRODUCT_VAULT_VERSION,
		localHalfKey
	};
	try {
		await putStaged({ requestId: args.requestId, record });
	} catch (err) {
		if (err instanceof DOMException && err.name === 'DataCloneError') {
			plain.fill(0);
			serverHalf.fill(0);
			return null;
		}
		throw err;
	}
	const back = await getStaged(args.requestId);
	if (!back?.record.localHalfKey || !back.record.wrappedPrivateKey || !back.record.wrapIv) fail('context', 'staged vault did not read back');
	const freshKey = await productWrapKey(back.record.localHalfKey, serverHalf);
	serverHalf.fill(0);
	const reread = new Uint8Array(
		await crypto.subtle.decrypt({ name: 'AES-GCM', iv: back.record.wrapIv as BufferSource }, freshKey, back.record.wrappedPrivateKey as BufferSource)
	);
	const same = bytesEqual(reread, plain);
	reread.fill(0);
	plain.fill(0);
	if (!same) {
		await deleteStaged(args.requestId);
		fail('context', 'staged vault did not read back');
	}
	return { record: back.record, wrapKey: freshKey };
}

export async function handleAdoptHandoff(args: AdoptHandoffArgs): Promise<AdoptHandoffResponse> {
	let root: Uint8Array | null = null;
	try {
		const authority = await parsePublicKey(args.keys.authorityKey);
		await validateProfile(PROFILE.accountAuthority, authority);
		await verifyTranscript(HEAD_DOMAIN, args.keys.head.raw, args.keys.head.authority, authority);
		const head = parseHeadV2(args.keys.head.raw);
		if (head.accountId !== args.accountId || keyId(args.accountId, fingerprintBytes(authority)) !== head.authorityKeyId) {
			fail('context', 'authority does not belong to the account head');
		}
		const e = await verifyHandoff(args.envelope, authority);
		const c = e.context;
		if (!sameContext(c, args, args.expect)) fail('context', 'envelope is bound to another request');
		if (c.accountHeadRevision !== head.stateRevision || !bytesEqual(c.accountHeadHash, await headHash(args.keys.head.raw))) {
			fail('context', 'envelope names another head');
		}
		const d = head.productDescriptors.find((x) => x.product === args.product);
		if (
			!d ||
			c.authorityEpoch !== head.authorityEpoch ||
			c.productKeyEpoch !== d.productKeyEpoch ||
			c.manifestId !== d.identityManifestId ||
			c.manifestRevision !== d.identityManifestRevision ||
			!bytesEqual(c.manifestHash, d.identityManifestHash)
		) {
			fail('context', 'envelope does not match the committed product');
		}
		if (Date.now() / 1000 > c.adoptBy) fail('context', 'adoption deadline passed');
		const secret = args.sharedSecret;
		const plain = await openHandoff(e, async () => secret);
		root = plain.productRoot;
		const entries = await openBundles(args, root, c, authority, head.authorityKeyId);
		const held = entries.filter((x): x is Entry & { material: Uint8Array } => x.material !== null);
		const vault: ProductVault = {
			product: args.product,
			root,
			currentKeyId: args.product === 'app' ? head.currentSigningKeyId : null,
			keys: held.map((x) => ({ keyId: x.keyId, scopeId: x.scopeId, purpose: x.purpose, profileId: x.profileId, keyEpoch: x.keyEpoch, material: x.material })),
			manifest: { manifestId: c.manifestId, revision: c.manifestRevision, hash: c.manifestHash, productKeyEpoch: c.productKeyEpoch }
		};
		const state = await productVaultState(args.accountId, args.email, vault);
		const staged = await stage(args, vault);
		for (const x of held) x.material.fill(0);
		pending.set(args.requestId, { accountId: args.accountId, state, staged: staged?.record ?? null, wrapKey: staged?.wrapKey ?? null });
		return { ok: true, envelopeDigest: await sha256(args.envelope), manifestHash: c.manifestHash, durable: staged !== null };
	} catch (err) {
		if (err instanceof ProductKeysError) return { ok: false, code: 'invalid', message: err.message };
		throw err;
	} finally {
		args.sharedSecret.fill(0);
		root?.fill(0);
	}
}

export async function handleCommitHandoff(args: CommitHandoffArgs): Promise<CommitHandoffResponse> {
	const p = pending.get(args.requestId);
	if (!p || p.accountId !== args.accountId) return { ok: false, code: 'missing' };
	if (p.staged) {
		await putVault(p.staged);
		cachedRecords.set(p.accountId, p.staged);
		await deleteStaged(args.requestId);
	}
	if (p.wrapKey) p.state.wrapKey = p.wrapKey;
	vaults.set(p.accountId, p.state);
	indexKeys.delete(p.accountId);
	pending.delete(args.requestId);
	broadcast({ type: 'vaultChanged', accountId: p.accountId, email: p.state.email });
	return { ok: true };
}

export async function handleDiscardHandoff(args: CommitHandoffArgs): Promise<void> {
	const p = pending.get(args.requestId);
	if (p && p.accountId !== args.accountId) return;
	pending.delete(args.requestId);
	await deleteStaged(args.requestId);
}

export async function restoreProductVault(rec: VaultRecord, wrapKey: CryptoKey, decoded: string): Promise<VaultState> {
	const vault = decodeProductVault(decoded);
	try {
		const state = await productVaultState(rec.accountId, rec.email, vault);
		state.wrapKey = wrapKey;
		return state;
	} finally {
		wipeProductVault(vault);
	}
}
