/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import type { CustodyJournal } from '$core/custody/journal';
import type { StagedCustodyVault } from '$core/custody/store';
import { commitCustody, deleteStagedVault, getStagedVault, putJournal, putStagedVault } from '$core/custody/store';
import type { VaultRecord } from '../idb';
import { deleteVault } from '../idb';
import { historyKeys } from '../productkeys/convert';
import { b64decode, keyId } from '../productkeys/encoding';
import { fail, ProductKeysError } from '../productkeys/errors';
import type { OpenedMailKeys } from '../productkeys/mailCandidate';
import { buildMailCandidate, openCommittedMailKeys, openMailCandidate, wipeOpenedMailKeys } from '../productkeys/mailCandidate';
import { fingerprintBytes } from '../productkeys/pgp';
import type { Availability } from '../productkeys/productBundle';
import { ENTRY } from '../productkeys/productBundle';
import type {
	CustodyAdoptArgs,
	CustodyAdoptResponse,
	CustodyCommitArgs,
	CustodyCommitResponse,
	CustodyPrepareArgs,
	CustodyPrepareResponse,
	CustodyRefusal,
	CustodyRetireArgs,
	CustodyRetireResponse,
	CustodyScopedArgs,
	CustodyStageArgs,
	CustodyStageResponse
} from '../protocol';
import type { ProductVault } from './product-vault';
import { decodeProductVault, encodeProductVault, PRODUCT_VAULT_VERSION, productVaultState, reopenProductRecord, sealProductRecord, wipeProductVault } from './product-vault';
import type { VaultState } from './state';
import { broadcast, cachedRecords, fingerprintHexOf, indexKeys, opaqueOps, pendingRotations, productAccounts, vaults } from './state';

interface PendingCustody {
	accountId: string;
	opened: OpenedMailKeys;
	state: VaultState | null;
	staged: StagedCustodyVault | null;
	wrapKey: CryptoKey | null;
}

const pending = new Map<string, PendingCustody>();

function source(accountId: string): VaultState | CustodyRefusal {
	const v = vaults.get(accountId);
	if (!v) return { ok: false, code: 'locked' };
	if (v.product || v.authScheme !== 'opaque_v1' || !v.masterKey || !v.keyPassword) return { ok: false, code: 'unsupported' };
	return v;
}

function refused(err: unknown): CustodyRefusal {
	if (err instanceof ProductKeysError) return { ok: false, code: 'invalid', message: err.message };
	throw err;
}

function drop(migrationId: string): void {
	const p = pending.get(migrationId);
	if (!p) return;
	wipeOpenedMailKeys(p.opened);
	pending.delete(migrationId);
}

export async function handleCustodyPrepare(args: CustodyPrepareArgs): Promise<CustodyPrepareResponse> {
	const v = source(args.accountId);
	if ('ok' in v) return v;
	try {
		const upload = await buildMailCandidate({
			accountId: args.accountId,
			amk: v.masterKey!,
			keyPassword: v.keyPassword,
			amkEpoch: args.amkEpoch,
			history: historyKeys(args.historyEvents),
			availability: new Map<string, Availability>(args.availability.map((a) => [a.keyId, a.state])),
			accountKeys: args.accountKeys,
			aliasKeys: args.aliasKeys
		});
		return { ok: true, upload };
	} catch (err) {
		return refused(err);
	}
}

function coversVault(v: VaultState, opened: OpenedMailKeys): void {
	const held = new Set(opened.entries.filter((e) => e.purpose === ENTRY.mailIdentity && e.material !== null).map((e) => e.keyId));
	for (const entry of v.accountKeys.values()) {
		if (!held.has(keyId(v.accountId, fingerprintBytes(entry.privateKey)))) fail('context', 'the stored keys miss one this vault holds');
	}
	if (!held.has(keyId(v.accountId, fingerprintBytes(v.privateKey)))) fail('context', 'the stored keys miss the current key');
}

export async function handleCustodyAdopt(args: CustodyAdoptArgs): Promise<CustodyAdoptResponse> {
	const v = source(args.accountId);
	if ('ok' in v) return v;
	let opened: OpenedMailKeys | null = null;
	try {
		opened =
			args.source.kind === 'candidate'
				? await openMailCandidate(args.accountId, v.masterKey!, v.keyPassword, args.source.stored)
				: await openCommittedMailKeys(args.accountId, v.masterKey!, v.keyPassword, args.source.stored);
		coversVault(v, opened);
		drop(args.migrationId);
		pending.set(args.migrationId, { accountId: args.accountId, opened, state: null, staged: null, wrapKey: null });
		return { ok: true, kind: opened.kind, digest: opened.digest.slice(), keyCount: opened.entries.filter((e) => e.material !== null).length };
	} catch (err) {
		if (opened) wipeOpenedMailKeys(opened);
		return refused(err);
	}
}

async function productVault(v: VaultState, opened: OpenedMailKeys): Promise<ProductVault> {
	const keys: ProductVault['keys'] = [];
	for (const e of opened.entries) {
		if (e.material === null) continue;
		const key: ProductVault['keys'][number] = { keyId: e.keyId, scopeId: e.scopeId, purpose: e.purpose, profileId: e.profileId, keyEpoch: e.keyEpoch, material: e.material.slice() };
		if (e.purpose === ENTRY.mailAlias) {
			const known = v.aliasKeys.get(fingerprintHexOf(await openpgp.readPrivateKey({ binaryKey: e.material.slice() })));
			if (known?.aliasId) key.alias = { aliasId: known.aliasId, addressId: known.addressId, email: known.email };
		}
		keys.push(key);
	}
	return {
		product: 'app',
		root: opened.root.slice(),
		currentKeyId: opened.currentKeyId ?? keyId(v.accountId, fingerprintBytes(v.privateKey)),
		keys,
		manifest: opened.manifest
	};
}

export async function handleCustodyStage(args: CustodyStageArgs): Promise<CustodyStageResponse> {
	const v = source(args.accountId);
	if ('ok' in v) return v;
	const p = pending.get(args.migrationId);
	if (!p || p.accountId !== args.accountId) return { ok: false, code: 'missing' };
	const vault = await productVault(v, p.opened);
	try {
		if (fingerprintHexOf((await productVaultState(args.accountId, v.email, vault)).privateKey) !== fingerprintHexOf(v.privateKey)) {
			fail('context', 'the stored keys name another current key');
		}
		p.staged = null;
		p.wrapKey = null;
		await deleteStagedVault(args.migrationId);
		if (args.serverHalf) {
			const serverHalf = b64decode(args.serverHalf);
			const { record, plain } = await sealProductRecord(args.accountId, v.email, vault, serverHalf);
			try {
				let stored = true;
				try {
					await putStagedVault({ migrationId: args.migrationId, accountId: args.accountId, record });
				} catch (err) {
					if (!(err instanceof DOMException) || err.name !== 'DataCloneError') throw err;
					stored = false;
				}
				if (stored) {
					const back = await getStagedVault(args.migrationId);
					try {
						p.wrapKey = await reopenProductRecord(back?.record, serverHalf, plain);
					} catch (err) {
						await deleteStagedVault(args.migrationId);
						throw err;
					}
					p.staged = back;
				}
			} finally {
				plain.fill(0);
				serverHalf.fill(0);
			}
		}
		const reread = decodeProductVault(new TextDecoder().decode(encodeProductVault(vault)));
		try {
			p.state = await productVaultState(args.accountId, v.email, reread);
		} finally {
			wipeProductVault(reread);
		}
		if (p.wrapKey) p.state.wrapKey = p.wrapKey;
		return { ok: true, durable: p.staged !== null };
	} catch (err) {
		return refused(err);
	} finally {
		wipeProductVault(vault);
	}
}

function checkJournal(args: CustodyCommitArgs | CustodyRetireArgs, state: CustodyJournal['state']): CustodyRefusal | null {
	if (args.journal.accountId !== args.accountId || args.journal.migrationId !== args.migrationId || args.journal.state !== state) {
		return { ok: false, code: 'invalid', message: `journal does not record ${state} for this migration` };
	}
	return null;
}

function dropLegacy(accountId: string): void {
	const v = vaults.get(accountId);
	if (!v || v.product) return;
	v.masterKey?.fill(0);
	v.masterKey = undefined;
	v.keyPassword = '';
	v.wrapKey = undefined;
	vaults.delete(accountId);
}

export async function handleCustodyCommit(args: CustodyCommitArgs): Promise<CustodyCommitResponse> {
	const bad = checkJournal(args, 'mail-committed');
	if (bad) return bad;
	const p = pending.get(args.migrationId);
	if (p && (p.accountId !== args.accountId || !p.state)) return { ok: false, code: 'missing' };
	const staged = p ? p.staged : await getStagedVault(args.migrationId);
	if (staged && staged.accountId !== args.accountId) return { ok: false, code: 'missing' };
	const email = p?.state?.email ?? staged?.record.email ?? vaults.get(args.accountId)?.email ?? cachedRecords.get(args.accountId)?.email ?? '';
	const record: VaultRecord = staged?.record ?? {
		accountId: args.accountId,
		email,
		authScheme: 'opaque_v1',
		armoredEncryptedPrivateKey: '',
		updatedAt: Date.now(),
		wrapPayloadVersion: PRODUCT_VAULT_VERSION
	};
	await commitCustody(args.journal, record);
	productAccounts.add(args.accountId);
	cachedRecords.set(args.accountId, record);
	indexKeys.delete(args.accountId);
	pendingRotations.delete(args.accountId);
	dropLegacy(args.accountId);
	if (p?.state) vaults.set(args.accountId, p.state);
	drop(args.migrationId);
	broadcast({ type: 'custodyChanged', accountId: args.accountId, email });
	return { ok: true };
}

export async function handleCustodyRetire(args: CustodyRetireArgs): Promise<CustodyRetireResponse> {
	if (!productAccounts.has(args.accountId) || vaults.get(args.accountId)?.product === undefined && vaults.has(args.accountId)) {
		return { ok: false, code: 'unsupported' };
	}
	const bad = checkJournal(args, 'legacy-retired-local');
	if (bad) return bad;
	opaqueOps.forgetAccount(args.accountId);
	pendingRotations.delete(args.accountId);
	const cached = cachedRecords.get(args.accountId);
	if (cached && (cached.wrapPayloadVersion ?? 1) < 3) cachedRecords.delete(args.accountId);
	await deleteVault(args.accountId);
	await putJournal(args.journal);
	return { ok: true };
}

export async function handleCustodyDiscard(args: CustodyScopedArgs): Promise<void> {
	const p = pending.get(args.migrationId);
	if (p && p.accountId !== args.accountId) return;
	drop(args.migrationId);
	await deleteStagedVault(args.migrationId);
}

export function forgetPendingCustody(accountId?: string): void {
	for (const [id, p] of pending) {
		if (accountId === undefined || p.accountId === accountId) drop(id);
	}
}
