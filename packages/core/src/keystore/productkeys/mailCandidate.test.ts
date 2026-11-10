// @vitest-environment node
import * as openpgp from 'openpgp';
import { beforeAll, describe, expect, it } from 'vitest';
import { candidateHash, parseCandidate } from './candidate';
import type { ConversionInput } from './convert';
import { buildConversion, deriveSearchLeaf, stripUserIds } from './convert';
import { bytesEqual, keyId, sha256 } from './encoding';
import { transcriptHash } from './envelope';
import { parseHeadV2 } from './head';
import type { MailCandidateInput, StoredCandidate } from './mailCandidate';
import { buildMailCandidate, openCommittedMailKeys, openMailCandidate } from './mailCandidate';
import { DOMAIN } from './manifests';
import { fingerprintBytes } from './pgp';
import type { Availability } from './productBundle';
import { ENTRY } from './productBundle';

const accountId = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const otherAccount = '8e1f4c2a-7b3d-4a5e-b6c9-0d2e3f4a5b6c';
const aliasId = '8b9c0d1e-2f3a-4b4c-9d6e-7f8091a2b3c4';
const keyPassword = 'cGFzc3BocmFzZS1mb3ItdGVzdHMtb25seQ==';

let input: ConversionInput;
let history: ConversionInput['history'];

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

function candidateInput(over: Partial<MailCandidateInput> = {}): MailCandidateInput {
	return {
		accountId,
		amk: input.amk,
		keyPassword,
		amkEpoch: input.scope.amkEpoch,
		history: input.history,
		availability: input.availability,
		accountKeys: input.accountKeys,
		aliasKeys: input.aliasKeys,
		...over
	};
}

function stored(upload: Awaited<ReturnType<typeof buildMailCandidate>>): StoredCandidate {
	return { record: upload.record, rootBundle: upload.rootBundle, bundles: upload.bundles.map((b) => ({ bundleId: b.bundleId, revision: b.revision, bundle: b.bundle })) };
}

beforeAll(async () => {
	const keys = [await mailKey(1), await mailKey(2), await mailKey(3)];
	history = await Promise.all(
		keys.map(async (k, i) => {
			const stripped = stripUserIds(k);
			return { keyId: keyId(accountId, fingerprintBytes(k)), keyEpoch: i + 1, profileId: 'mail-classic-v1', publicKeyHash: await sha256(stripped), publicKeyBytes: stripped };
		})
	);
	const current = await openpgp.decryptKey({ privateKey: keys[2], passphrase: keyPassword });
	const { privateKey: alias } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'team@thelemail.test' }], format: 'object', config: { v6Keys: true } });
	const wrapped = await openpgp.encrypt({ message: await openpgp.createMessage({ text: alias.armor() }), encryptionKeys: current.toPublic() });
	input = {
		accountId,
		amk: crypto.getRandomValues(new Uint8Array(32)),
		keyPassword,
		scope: { stateRevision: 0, activeKeyEpoch: 3, activeGeneration: 1, authEpoch: 2, recoveryEpoch: 1, amkEpoch: 1, minimumWriteProfile: null, historyEventCount: 5, keyHistoryRoot: new Uint8Array(32).fill(7) },
		sessionEpoch: 4,
		previousHeadHash: null,
		credentialHashes: [new Uint8Array(32).fill(1)],
		slotHashes: [new Uint8Array(32).fill(2)],
		history,
		availability: new Map<string, Availability>([
			[history[0].keyId, 'available'],
			[history[1].keyId, 'destroyed-managed'],
			[history[2].keyId, 'available']
		]),
		accountKeys: [
			{ armoredEncrypted: keys[0].armor(), isCurrent: false },
			{ armoredEncrypted: keys[1].armor(), isCurrent: false },
			{ armoredEncrypted: keys[2].armor(), isCurrent: true }
		],
		aliasKeys: [{ aliasId, keyVersion: 1, wrappedPrivateKey: wrapped as string }]
	};
}, 60_000);

describe('mail custody candidate', () => {
	it('reads back the whole keyring from the uploaded bytes alone', async () => {
		const upload = await buildMailCandidate(candidateInput());
		expect(Object.keys(upload).sort()).toEqual(['bundles', 'record', 'rootBundle', 'rootBundleId', 'rootBundleRevision']);
		const opened = await openMailCandidate(accountId, input.amk, keyPassword, stored(upload));
		expect(opened.kind).toBe('candidate');
		expect(opened.digest).toEqual(await candidateHash(upload.record));
		const byKey = new Map(opened.entries.map((e) => [e.keyId, e]));
		expect(byKey.get(history[0].keyId)?.material).not.toBeNull();
		expect(byKey.get(history[1].keyId)).toMatchObject({ availability: 'destroyed-managed', material: null });
		expect(byKey.get(history[2].keyId)?.material).not.toBeNull();
		expect(opened.entries.filter((e) => e.purpose === ENTRY.mailAlias).map((e) => e.scopeId)).toEqual([aliasId]);
		expect(opened.entries.find((e) => e.purpose === ENTRY.mailSearchIndex)?.material).toEqual(await deriveSearchLeaf(keyPassword, accountId));
		expect(opened.root).toHaveLength(32);
		expect(bytesEqual(opened.root, input.amk)).toBe(false);
		expect(parseCandidate(upload.record).amkEpoch).toBe(1);
	});

	it('splits a large keyring and reads every page back', async () => {
		const upload = await buildMailCandidate(candidateInput({ bundleBudget: 1500 }));
		expect(upload.bundles.length).toBeGreaterThan(2);
		const opened = await openMailCandidate(accountId, input.amk, keyPassword, stored(upload));
		expect(opened.entries.filter((e) => e.purpose === ENTRY.mailIdentity)).toHaveLength(3);
		const missing = stored(upload);
		missing.bundles = missing.bundles.slice(1);
		await expect(openMailCandidate(accountId, input.amk, keyPassword, missing)).rejects.toMatchObject({ code: 'context' });
	});

	it('refuses a candidate it cannot authenticate end to end', async () => {
		const mine = stored(await buildMailCandidate(candidateInput()));
		const theirs = stored(await buildMailCandidate(candidateInput()));

		await expect(openMailCandidate(accountId, crypto.getRandomValues(new Uint8Array(32)), keyPassword, mine)).rejects.toMatchObject({ code: 'decrypt' });
		await expect(openMailCandidate(otherAccount, input.amk, keyPassword, mine)).rejects.toMatchObject({ code: 'context' });
		await expect(openMailCandidate(accountId, input.amk, keyPassword, { ...mine, rootBundle: theirs.rootBundle })).rejects.toMatchObject({ code: 'context' });
		await expect(openMailCandidate(accountId, input.amk, keyPassword, { ...mine, bundles: theirs.bundles })).rejects.toMatchObject({ code: 'context' });
		const flipped = mine.bundles.map((b) => ({ ...b, bundle: b.bundle.slice() }));
		flipped[0].bundle[flipped[0].bundle.length - 8] ^= 1;
		await expect(openMailCandidate(accountId, input.amk, keyPassword, { ...mine, bundles: flipped })).rejects.toMatchObject({ code: 'context' });
		await expect(openMailCandidate(accountId, input.amk, 'another passphrase', mine)).rejects.toBeDefined();
	});

	it('gives two devices different roots, so only the winner may be adopted', async () => {
		const a = await openMailCandidate(accountId, input.amk, keyPassword, stored(await buildMailCandidate(candidateInput())));
		const b = await openMailCandidate(accountId, input.amk, keyPassword, stored(await buildMailCandidate(candidateInput())));
		expect(bytesEqual(a.root, b.root)).toBe(false);
		expect(bytesEqual(a.digest, b.digest)).toBe(false);
	});

	it('lets the auth conversion commit the adopted root instead of minting one', async () => {
		const candidate = await openMailCandidate(accountId, input.amk, keyPassword, stored(await buildMailCandidate(candidateInput())));
		const out = await buildConversion({ ...input, appRoot: candidate.root });
		const head = parseHeadV2(out.activation.head);
		const d = head.productDescriptors.find((x) => x.product === 'app')!;
		const manifest = out.identityManifests.find((m) => m.product === 'app')!;
		const committed = await openCommittedMailKeys(accountId, input.amk, keyPassword, {
			head: { raw: out.activation.head, mac: out.activation.mac },
			rootBundle: out.secretBundles.find((b) => b.bundleId === d.rootBundleId)!,
			identityManifest: manifest.record,
			bundles: out.productBundles.filter((b) => b.product === 'app')
		});
		expect(committed.kind).toBe('committed');
		expect(committed.root).toEqual(candidate.root);
		expect(committed.currentKeyId).toBe(history[2].keyId);
		expect(committed.digest).toEqual(await transcriptHash(DOMAIN.identityManifest, manifest.record));
		expect(committed.manifest).toMatchObject({ revision: 1, productKeyEpoch: 1 });
		expect(committed.entries.filter((e) => e.material !== null && e.purpose === ENTRY.mailIdentity)).toHaveLength(2);

		const fresh = await buildConversion(input);
		const freshHead = parseHeadV2(fresh.activation.head);
		const fd = freshHead.productDescriptors.find((x) => x.product === 'app')!;
		const other = await openCommittedMailKeys(accountId, input.amk, keyPassword, {
			head: { raw: fresh.activation.head, mac: fresh.activation.mac },
			rootBundle: fresh.secretBundles.find((b) => b.bundleId === fd.rootBundleId)!,
			identityManifest: fresh.identityManifests.find((m) => m.product === 'app')!.record,
			bundles: fresh.productBundles.filter((b) => b.product === 'app')
		});
		expect(bytesEqual(other.root, candidate.root)).toBe(false);
	});

	it('refuses committed keys whose head or manifest does not authenticate', async () => {
		const out = await buildConversion(input);
		const head = parseHeadV2(out.activation.head);
		const d = head.productDescriptors.find((x) => x.product === 'app')!;
		const good = {
			head: { raw: out.activation.head, mac: out.activation.mac },
			rootBundle: out.secretBundles.find((b) => b.bundleId === d.rootBundleId)!,
			identityManifest: out.identityManifests.find((m) => m.product === 'app')!.record,
			bundles: out.productBundles.filter((b) => b.product === 'app')
		};
		await expect(openCommittedMailKeys(accountId, input.amk, keyPassword, good)).resolves.toBeDefined();
		const badMac = out.activation.mac.slice();
		badMac[0] ^= 1;
		await expect(openCommittedMailKeys(accountId, input.amk, keyPassword, { ...good, head: { raw: good.head.raw, mac: badMac } })).rejects.toBeDefined();
		const calendar = parseHeadV2(out.activation.head).productDescriptors.find((x) => x.product === 'calendar')!;
		await expect(
			openCommittedMailKeys(accountId, input.amk, keyPassword, { ...good, rootBundle: out.secretBundles.find((b) => b.bundleId === calendar.rootBundleId)! })
		).rejects.toMatchObject({ code: 'context' });
		await expect(
			openCommittedMailKeys(accountId, input.amk, keyPassword, { ...good, identityManifest: out.identityManifests.find((m) => m.product === 'calendar')!.record })
		).rejects.toMatchObject({ code: 'context' });
		await expect(openCommittedMailKeys(accountId, input.amk, keyPassword, { ...good, bundles: [] })).rejects.toMatchObject({ code: 'context' });
	});
});
