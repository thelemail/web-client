// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';
import type { ConversionInput, ConversionOutput } from './convert';
import { buildConversion, stripUserIds } from './convert';
import { keyId, sha256 } from './encoding';
import { parseHeadV2, verifySuccessor } from './head';
import { parseDataManifest, parseDelegation, parseIdentityManifest } from './manifests';
import { fingerprintBytes, parsePublicKey } from './pgp';
import type { Availability } from './productBundle';
import type { ProductReadInput, ReadInput, StoredBundle } from './read';
import { readProductKeys } from './read';
import type { SuccessorInput, SuccessorOutput } from './successor';
import { buildSuccessor } from './successor';

const accountId = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const aliasId = '8b9c0d1e-2f3a-4b4c-9d6e-7f8091a2b3c4';
const keyPassword = 'cGFzc3BocmFzZS1mb3ItdGVzdHMtb25seQ==';

async function mailKey(n: number) {
	const { privateKey } = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ name: 'Calloway', email: `calloway${n}@thelemail.test` }],
		passphrase: keyPassword,
		format: 'object',
		config: { v6Keys: true }
	});
	return privateKey;
}

async function historyOf(keys: openpgp.PrivateKey[]) {
	return Promise.all(
		keys.map(async (k, i) => {
			const stripped = stripUserIds(k);
			return { keyId: keyId(accountId, fingerprintBytes(k)), keyEpoch: i + 1, profileId: 'mail-classic-v1', publicKeyHash: await sha256(stripped), publicKeyBytes: stripped };
		})
	);
}

async function grant(to: openpgp.PrivateKey, version: number) {
	const current = await openpgp.decryptKey({ privateKey: to, passphrase: keyPassword });
	const { privateKey: alias } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: `team${version}@thelemail.test` }], format: 'object', config: { v6Keys: true } });
	const wrapped = await openpgp.encrypt({ message: await openpgp.createMessage({ text: alias.armor() }), encryptionKeys: current.toPublic() });
	return { aliasId, keyVersion: version, wrappedPrivateKey: wrapped as string };
}

interface Stored {
	raw: Uint8Array;
	mac: Uint8Array;
	authoritySignature: Uint8Array;
	legacySignature: Uint8Array | null;
	authorityKey: Uint8Array;
	secretBundles: StoredBundle[];
	products: ProductReadInput[];
}

function stored(out: ConversionOutput): Stored {
	const products: ProductReadInput[] = (['app', 'calendar'] as const).map((product, i) => {
		const m = out.identityManifests.find((x) => x.product === product)!;
		const d = out.activation.delegations[i];
		return {
			product,
			identityManifest: { record: m.record, signature: m.signature },
			delegation: { record: d.record, signature: d.signature, signingPublicKey: d.signingPublicKey },
			dataManifest: out.dataManifests.filter((x) => x.product === product).map((x) => ({ record: x.record, signature: x.signature })),
			bundles: out.productBundles.filter((b) => b.product === product)
		};
	});
	return {
		raw: out.activation.head,
		mac: out.activation.mac,
		authoritySignature: out.activation.authoritySignature,
		legacySignature: out.activation.legacySignature,
		authorityKey: out.activation.authorityPublicKey,
		secretBundles: out.secretBundles,
		products
	};
}

function apply(s: Stored, next: SuccessorOutput): Stored {
	const secretBundles = [...s.secretBundles, ...next.secretBundles];
	const products = s.products.map((p) => {
		if (p.product !== 'app') return p;
		const manifest = next.identityManifests.find((m) => m.product === 'app');
		const delegation = next.activation.delegations[0];
		const data = next.dataManifests.filter((m) => m.product === 'app');
		return {
			...p,
			identityManifest: manifest ? { record: manifest.record, signature: manifest.signature } : p.identityManifest,
			delegation: delegation ? { record: delegation.record, signature: delegation.signature, signingPublicKey: delegation.signingPublicKey } : p.delegation,
			dataManifest: data.length > 0 ? data.map((m) => ({ record: m.record, signature: m.signature })) : p.dataManifest,
			bundles: manifest ? next.productBundles.filter((b) => b.product === 'app') : p.bundles
		};
	});
	return { ...s, raw: next.activation.head, mac: next.activation.mac, authoritySignature: next.activation.authoritySignature, legacySignature: null, secretBundles, products };
}

function readOf(s: Stored, amk: Uint8Array, mailKeys: openpgp.Key[]): ReadInput {
	return {
		accountId,
		amk,
		keyPassword,
		mailKeys,
		authorityKey: s.authorityKey,
		head: { raw: s.raw, mac: s.mac, previousHeadHash: parseHeadV2(s.raw).previousHeadHash, authority: s.authoritySignature, legacy: s.legacySignature, transition: null },
		secretBundles: s.secretBundles,
		products: s.products
	};
}

async function converted() {
	const keys = [await mailKey(1), await mailKey(2)];
	const history = await historyOf(keys);
	const availability = new Map<string, Availability>(history.map((h) => [h.keyId, 'available']));
	const input: ConversionInput = {
		accountId,
		amk: crypto.getRandomValues(new Uint8Array(32)),
		keyPassword,
		scope: { stateRevision: 0, activeKeyEpoch: 2, activeGeneration: 1, authEpoch: 2, recoveryEpoch: 1, amkEpoch: 1, minimumWriteProfile: null, historyEventCount: 3, keyHistoryRoot: new Uint8Array(32).fill(7) },
		sessionEpoch: 4,
		previousHeadHash: null,
		credentialHashes: [new Uint8Array(32).fill(1)],
		slotHashes: [new Uint8Array(32).fill(2)],
		history,
		availability,
		accountKeys: keys.map((k, i) => ({ armoredEncrypted: k.armor(), isCurrent: i === keys.length - 1 })),
		aliasKeys: [await grant(keys[1], 1)]
	};
	const out = await buildConversion(input);
	return { keys, history, input, store: stored(out) };
}

type Converted = Awaited<ReturnType<typeof converted>>;

function successorInput(c: Converted, s: Stored, change: Partial<SuccessorInput> = {}): SuccessorInput {
	return {
		accountId,
		amk: c.input.amk,
		keyPassword,
		scope: { ...c.input.scope, stateRevision: parseHeadV2(s.raw).stateRevision },
		sessionEpoch: c.input.sessionEpoch,
		credentialHashes: c.input.credentialHashes,
		slotHashes: c.input.slotHashes,
		history: c.history,
		availability: c.input.availability,
		accountKeys: c.input.accountKeys,
		aliasKeys: c.input.aliasKeys,
		previous: { raw: s.raw, mac: s.mac },
		secretBundles: s.secretBundles,
		products: s.products,
		...change
	};
}

async function chained(prev: Stored, next: SuccessorOutput) {
	const authority = await parsePublicKey(prev.authorityKey);
	return verifySuccessor(prev.raw, next.activation.head, { authority: next.activation.authoritySignature, legacy: null, transition: null }, authority, authority, 1);
}

describe('successor heads', () => {
	it('builds nothing while the account is unchanged', async () => {
		const c = await converted();
		expect(await buildSuccessor(successorInput(c, c.store))).toBeNull();
	});

	it('commits a password change in a head-only successor', async () => {
		const c = await converted();
		const scope = { ...c.input.scope, stateRevision: 1, authEpoch: 3 };
		const next = await buildSuccessor(successorInput(c, c.store, { scope, credentialHashes: [new Uint8Array(32).fill(9)], sessionEpoch: 5 }));
		expect(next).not.toBeNull();
		expect(next!.productBundles).toHaveLength(0);
		expect(next!.secretBundles).toHaveLength(0);
		expect(next!.activation.delegations).toHaveLength(0);
		const head = await chained(c.store, next!);
		expect(head).toMatchObject({ stateRevision: 2, authEpoch: 3, observedSessionEpoch: 5 });
		expect(head.credentialDescriptorHashes).toEqual([new Uint8Array(32).fill(9)]);
		const after = apply(c.store, next!);
		await expect(readProductKeys(readOf(after, c.input.amk, c.keys.map((k) => k.toPublic())))).resolves.toMatchObject({ stateRevision: 2 });
		expect(await buildSuccessor(successorInput(c, after, { scope: { ...scope, stateRevision: 2 }, credentialHashes: [new Uint8Array(32).fill(9)], sessionEpoch: 5 }))).toBeNull();
	});

	it('moves the mail delegation, bundle and data manifest to a rotated key', async () => {
		const c = await converted();
		const keys = [...c.keys, await mailKey(3)];
		const history = await historyOf(keys);
		const next = await buildSuccessor(
			successorInput(c, c.store, {
				scope: { ...c.input.scope, stateRevision: 1, activeKeyEpoch: 3, historyEventCount: 5 },
				history,
				availability: new Map(history.map((h) => [h.keyId, 'available' as Availability])),
				accountKeys: keys.map((k, i) => ({ armoredEncrypted: k.armor(), isCurrent: i === keys.length - 1 }))
			})
		);
		const head = await chained(c.store, next!);
		expect(head.currentSigningKeyId).toBe(history[2].keyId);
		const delegation = parseDelegation(next!.activation.delegations[0].record);
		expect(delegation).toMatchObject({ signingKeyId: history[2].keyId, delegationRevision: 2 });
		expect(parseIdentityManifest(next!.identityManifests[0].record).revision).toBe(2);
		expect(next!.secretBundles).toEqual([expect.objectContaining({ kind: 'product-root', revision: 2 })]);
		expect(parseDataManifest(next!.dataManifests[0].record)).toMatchObject({ revision: 2, signerKeyId: history[2].keyId, delegationRevision: 2 });
		const after = apply(c.store, next!);
		const result = await readProductKeys(readOf(after, c.input.amk, keys.map((k) => k.toPublic())));
		const app = result.products.find((p) => p.product === 'app')!;
		expect(app.entries.filter((e) => e.purpose === 'mail.identity').map((e) => e.keyId).sort()).toEqual(history.map((h) => h.keyId).sort());
		expect(app.dataManifestPages).toBe(1);
	});

	it('rebuilds the mail bundle for a new alias key without a new delegation', async () => {
		const c = await converted();
		const next = await buildSuccessor(successorInput(c, c.store, { aliasKeys: [await grant(c.keys[1], 2)] }));
		expect(next!.activation.delegations).toHaveLength(0);
		expect(next!.dataManifests).toHaveLength(0);
		expect(next!.identityManifests).toHaveLength(1);
		await chained(c.store, next!);
		const after = apply(c.store, next!);
		const result = await readProductKeys(readOf(after, c.input.amk, c.keys.map((k) => k.toPublic())));
		expect(result.products.find((p) => p.product === 'app')!.entries.find((e) => e.purpose === 'mail.alias')).toMatchObject({ keyEpoch: 2 });
	});

	it('refuses a head under another master key or a moved revision', async () => {
		const c = await converted();
		await expect(buildSuccessor(successorInput(c, c.store, { amk: crypto.getRandomValues(new Uint8Array(32)) }))).rejects.toMatchObject({ code: 'signature' });
		await expect(buildSuccessor(successorInput(c, c.store, { scope: { ...c.input.scope, stateRevision: 7 } }))).rejects.toMatchObject({ code: 'context' });
		await expect(buildSuccessor(successorInput(c, c.store, { scope: { ...c.input.scope, stateRevision: 1, amkEpoch: 2 } }))).rejects.toMatchObject({ code: 'context' });
	});
});
