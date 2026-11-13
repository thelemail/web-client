/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { deleteVault, putVault } from '../idb';
import type { VaultRecord } from '../idb';
import { JOURNAL_SCHEMA } from '$core/custody/journal';
import { commitCustody, getJournal } from '$core/custody/store';
import { currentProduct } from '../../products';
import { openHandoff, verifyHandoff } from '../handoff/envelope';
import { deleteStaged, getStaged, putStaged } from '../handoff/store';
import type { Context } from '../handoff/wire';
import { b64decode, b64encode, bytesEqual, keyId, sha256 } from '../productkeys/encoding';
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
import { decodeProductVault, PRODUCT_VAULT_VERSION, productVaultState, reopenProductRecord, sealProductRecord, wipeProductVault } from './product-vault';
import type { VaultState } from './state';
import { broadcast, cachedRecords, indexKeys, installVault, productAccounts, vaults, wipeProductRoot } from './state';

interface PendingAdoption {
	accountId: string;
	state: VaultState;
	staged: VaultRecord | null;
	wrapKey: CryptoKey | null;
	manifestHash: Uint8Array;
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
	const serverHalf = b64decode(args.serverHalf);
	const { record, plain } = await sealProductRecord(args.accountId, args.email, vault, serverHalf);
	try {
		try {
			await putStaged({ requestId: args.requestId, record });
		} catch (err) {
			if (err instanceof DOMException && err.name === 'DataCloneError') return null;
			throw err;
		}
		const back = await getStaged(args.requestId);
		try {
			return { record: back!.record, wrapKey: await reopenProductRecord(back?.record, serverHalf, plain) };
		} catch (err) {
			await deleteStaged(args.requestId);
			throw err;
		}
	} finally {
		plain.fill(0);
		serverHalf.fill(0);
	}
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
		pending.set(args.requestId, { accountId: args.accountId, state, staged: staged?.record ?? null, wrapKey: staged?.wrapKey ?? null, manifestHash: c.manifestHash.slice() });
		return { ok: true, envelopeDigest: await sha256(args.envelope), manifestHash: c.manifestHash, durable: staged !== null };
	} catch (err) {
		if (err instanceof ProductKeysError) return { ok: false, code: 'invalid', message: err.message };
		throw err;
	} finally {
		args.sharedSecret.fill(0);
		root?.fill(0);
	}
}

async function commitMailAdoption(requestId: string, p: PendingAdoption): Promise<void> {
	const existing = await getJournal(p.accountId);
	const now = Date.now();
	const record: VaultRecord = p.staged ?? {
		accountId: p.accountId,
		email: p.state.email,
		authScheme: 'opaque_v1',
		armoredEncryptedPrivateKey: '',
		updatedAt: now,
		wrapPayloadVersion: PRODUCT_VAULT_VERSION
	};
	await commitCustody(
		{
			accountId: p.accountId,
			schema: JOURNAL_SCHEMA,
			migrationId: existing?.migrationId ?? requestId,
			state: 'complete',
			target: { kind: 'committed', digest: b64encode(p.manifestHash) },
			exchange: null,
			sessionId: existing?.sessionId ?? null,
			startedAt: existing?.startedAt ?? now,
			updatedAt: now,
			failure: null
		},
		record
	);
	productAccounts.add(p.accountId);
	cachedRecords.set(p.accountId, record);
	await deleteVault(p.accountId);
	await deleteStaged(requestId);
}

export async function handleCommitHandoff(args: CommitHandoffArgs): Promise<CommitHandoffResponse> {
	const p = pending.get(args.requestId);
	if (!p || p.accountId !== args.accountId) return { ok: false, code: 'missing' };
	if (currentProduct === 'app') {
		await commitMailAdoption(args.requestId, p);
	} else if (p.staged) {
		await putVault(p.staged);
		cachedRecords.set(p.accountId, p.staged);
		await deleteStaged(args.requestId);
	}
	if (p.wrapKey) p.state.wrapKey = p.wrapKey;
	installVault(p.state);
	indexKeys.delete(p.accountId);
	pending.delete(args.requestId);
	broadcast({ type: 'vaultChanged', accountId: p.accountId, email: p.state.email });
	return { ok: true };
}

export async function handleDiscardHandoff(args: CommitHandoffArgs): Promise<void> {
	const p = pending.get(args.requestId);
	if (p && p.accountId !== args.accountId) return;
	if (p && vaults.get(p.accountId) !== p.state) wipeProductRoot(p.state);
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
