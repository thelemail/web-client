// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';
import { utf8 } from './canonical';
import type { ConversionInput, ConversionOutput } from './convert';
import { buildConversion, deriveSearchLeaf, stripUserIds } from './convert';
import { keyId, sha256 } from './encoding';
import { ProductKeysError } from './errors';
import { parseHeadV2 } from './head';
import { fingerprintBytes } from './pgp';
import type { Availability } from './productBundle';
import { sealProductBundle } from './productBundle';
import type { ProductReadInput } from './read';
import { readProductKeys } from './read';

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

async function fixture() {
	const keys = [await mailKey(1), await mailKey(2), await mailKey(3)];
	const history = await Promise.all(
		keys.map(async (k, i) => {
			const stripped = stripUserIds(k);
			return { keyId: keyId(accountId, fingerprintBytes(k)), keyEpoch: i + 1, profileId: 'mail-classic-v1', publicKeyHash: await sha256(stripped), publicKeyBytes: stripped };
		})
	);
	const availability = new Map<string, Availability>([
		[history[0].keyId, 'available'],
		[history[1].keyId, 'destroyed-managed'],
		[history[2].keyId, 'available']
	]);
	const current = await openpgp.decryptKey({ privateKey: keys[2], passphrase: keyPassword });
	const { privateKey: alias } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'team@thelemail.test' }], format: 'object', config: { v6Keys: true } });
	const wrapped = await openpgp.encrypt({ message: await openpgp.createMessage({ text: alias.armor() }), encryptionKeys: current.toPublic() });
	const amk = crypto.getRandomValues(new Uint8Array(32));
	const input: ConversionInput = {
		accountId,
		amk,
		keyPassword,
		scope: { stateRevision: 0, activeKeyEpoch: 3, activeGeneration: 1, authEpoch: 2, recoveryEpoch: 1, amkEpoch: 1, minimumWriteProfile: null, historyEventCount: 5, keyHistoryRoot: new Uint8Array(32).fill(7) },
		sessionEpoch: 4,
		previousHeadHash: null,
		credentialHashes: [new Uint8Array(32).fill(1)],
		slotHashes: [new Uint8Array(32).fill(2), new Uint8Array(32).fill(3)],
		history,
		availability,
		accountKeys: [
			{ armoredEncrypted: keys[0].armor(), isCurrent: false },
			{ armoredEncrypted: keys[1].armor(), isCurrent: false },
			{ armoredEncrypted: keys[2].armor(), isCurrent: true }
		],
		aliasKeys: [{ aliasId, keyVersion: 1, wrappedPrivateKey: wrapped as string }]
	};
	return { input, history, current, alias, keys };
}

function readInput(f: Awaited<ReturnType<typeof fixture>>, out: ConversionOutput) {
	const products: ProductReadInput[] = (['app', 'calendar'] as const).map((product) => {
		const manifest = out.identityManifests.find((m) => m.product === product)!;
		const delegationIndex = product === 'app' ? 0 : 1;
		const d = out.activation.delegations[delegationIndex];
		return {
			product,
			identityManifest: { record: manifest.record, signature: manifest.signature },
			delegation: { record: d.record, signature: d.signature, signingPublicKey: d.signingPublicKey },
			dataManifest: out.dataManifests.filter((m) => m.product === product).map((m) => ({ record: m.record, signature: m.signature })),
			bundles: out.productBundles.filter((b) => b.product === product)
		};
	});
	return {
		accountId,
		amk: f.input.amk,
		keyPassword,
		mailKeys: f.keys.map((k) => k.toPublic()),
		authorityKey: out.activation.authorityPublicKey,
		head: { raw: out.activation.head, mac: out.activation.mac, previousHeadHash: null, authority: out.activation.authoritySignature, legacy: out.activation.legacySignature, transition: null },
		secretBundles: out.secretBundles,
		products
	};
}

describe('product key conversion', () => {
	it('reads back every key after rotations with a destroyed intermediate', async () => {
		const f = await fixture();
		const out = await buildConversion(f.input);
		const result = await readProductKeys(readInput(f, out));
		const app = result.products.find((p) => p.product === 'app')!;
		const byKey = new Map(app.entries.map((e) => [e.keyId, e]));
		expect(byKey.get(f.history[0].keyId)).toMatchObject({ availability: 'available', held: true, keyEpoch: 1 });
		expect(byKey.get(f.history[1].keyId)).toMatchObject({ availability: 'destroyed-managed', held: false, keyEpoch: 2 });
		expect(byKey.get(f.history[2].keyId)).toMatchObject({ availability: 'available', held: true, keyEpoch: 3 });
		expect(app.entries.filter((e) => e.purpose === 'mail.alias').map((e) => e.scopeId)).toEqual([aliasId]);
		expect(result.importDedupMatches).toBe(true);
		expect(result.searchLeafMatches).toBe(true);
		const calendar = result.products.find((p) => p.product === 'calendar')!;
		expect(calendar.entries.map((e) => e.purpose)).toEqual(['calendar.identity']);
		expect(calendar.dataManifestPages).toBe(1);
		expect(parseHeadV2(out.activation.head).productDescriptors.map((d) => d.product)).toEqual(['app', 'calendar']);
	});

	it('keeps roots and the key passphrase out of every bundle', async () => {
		const f = await fixture();
		const out = await buildConversion(f.input);
		const all = [...out.productBundles.map((b) => b.bundle), ...out.secretBundles.map((b) => b.bundle), ...out.identityManifests.map((m) => m.record)];
		const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
		for (const b of all) {
			const text = new TextDecoder().decode(b);
			expect(text.includes(keyPassword)).toBe(false);
			expect(text.includes(btoa(String.fromCharCode(...f.input.amk)))).toBe(false);
			expect(hex(b).includes(hex(f.input.amk))).toBe(false);
		}
		const root = crypto.getRandomValues(new Uint8Array(32));
		const header = { accountId, product: 'app' as const, productKeyEpoch: 1, bundleId: aliasId, revision: 1 };
		for (const material of [f.input.amk, utf8(keyPassword), root]) {
			await expect(
				sealProductBundle(root, header, [{ keyId: aliasId, scopeId: accountId, purpose: 'mail.import-dedup', profileId: 'mail-import-dedup-v1', keyEpoch: 1, availability: 'available', material }], [f.input.amk, utf8(keyPassword)])
			).rejects.toBeInstanceOf(ProductKeysError);
		}
		await expect(
			sealProductBundle(root, header, [{ keyId: aliasId, scopeId: accountId, purpose: 'account.amk', profileId: 'secret-wrap-v2', keyEpoch: 1, availability: 'available', material: f.input.amk }], [])
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('refuses a read under another amk or with a swapped bundle', async () => {
		const f = await fixture();
		const out = await buildConversion(f.input);
		const input = readInput(f, out);
		await expect(readProductKeys({ ...input, amk: crypto.getRandomValues(new Uint8Array(32)) })).rejects.toMatchObject({ code: 'signature' });
		const swapped = { ...input, products: input.products.map((p) => (p.product === 'app' ? { ...p, bundles: input.products[1].bundles } : p)) };
		await expect(readProductKeys(swapped)).rejects.toMatchObject({ code: 'context' });
		const mailSigned = { ...input, head: { ...input.head, legacy: null, authority: input.head.legacy } };
		await expect(readProductKeys(mailSigned)).rejects.toMatchObject({ code: 'signature' });
	});

	it('signs with the published current key even when the caller holds an older one', async () => {
		const f = await fixture();
		const out = await buildConversion(f.input);
		const head = parseHeadV2(out.activation.head);
		expect(head.currentSigningKeyId).toBe(f.history[2].keyId);
		const swapped = { ...f.input, accountKeys: f.input.accountKeys.map((k, i) => ({ ...k, isCurrent: i === 0 })) };
		await expect(buildConversion(swapped)).resolves.toBeDefined();
		const none = { ...f.input, accountKeys: f.input.accountKeys.map((k) => ({ ...k, isCurrent: false })) };
		await expect(buildConversion(none)).rejects.toMatchObject({ code: 'context' });
	});

	it('still reads back after a later mail key rotation', async () => {
		const f = await fixture();
		const out = await buildConversion(f.input);
		const later = await mailKey(4);
		const input = readInput(f, out);
		const result = await readProductKeys({ ...input, mailKeys: [later.toPublic(), ...input.mailKeys] });
		expect(result.importDedupMatches).toBe(true);
		await expect(readProductKeys({ ...input, mailKeys: [later.toPublic()] })).rejects.toMatchObject({ code: 'context' });
	});

	it('splits a large keyring across bundles and reads every page back', async () => {
		const f = await fixture();
		const out = await buildConversion({ ...f.input, bundleBudget: 1500 });
		const app = out.productBundles.filter((b) => b.product === 'app');
		expect(app.length).toBeGreaterThan(2);
		const manifest = JSON.parse(new TextDecoder().decode(out.identityManifests.find((m) => m.product === 'app')!.record));
		expect(manifest.bundles.map((b: { bundleId: string }) => b.bundleId).sort()).toEqual(app.map((b) => b.bundleId).sort());
		const result = await readProductKeys(readInput(f, out));
		const entries = result.products.find((p) => p.product === 'app')!.entries;
		expect(entries.filter((e) => e.purpose === 'mail.identity')).toHaveLength(3);
		expect(entries.filter((e) => e.purpose === 'mail.alias')).toHaveLength(1);
		expect(result.importDedupMatches && result.searchLeafMatches).toBe(true);
		const input = readInput(f, out);
		const missing = { ...input, products: input.products.map((p) => (p.product === 'app' ? { ...p, bundles: p.bundles.slice(1) } : p)) };
		await expect(readProductKeys(missing)).rejects.toMatchObject({ code: 'context' });
	});

	it('derives the search leaf the mail worker uses', async () => {
		const ikm = await crypto.subtle.importKey('raw', utf8(keyPassword), 'HKDF', false, ['deriveKey']);
		const key = await crypto.subtle.deriveKey(
			{ name: 'HKDF', hash: 'SHA-256', salt: utf8(accountId), info: utf8('thelemail-search-index-v1') },
			ikm,
			{ name: 'AES-GCM', length: 256 },
			true,
			['encrypt', 'decrypt']
		);
		const exported = new Uint8Array(await crypto.subtle.exportKey('raw', key));
		expect(await deriveSearchLeaf(keyPassword, accountId)).toEqual(exported);
	});
});
