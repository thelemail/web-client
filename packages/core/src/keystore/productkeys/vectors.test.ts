// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';
import raw from './fixtures/product-keys-v1-vectors.json?raw';
import { utf8 } from './canonical';
import { b64decode, b64encode, sha256 } from './encoding';
import { transcriptHash } from './envelope';
import { ProductKeysError } from './errors';
import type { HeadSignatures } from './head';
import { headHash, verifyBootstrap, verifyHeadMac, verifySuccessor } from './head';
import { DOMAIN, parseDataManifest, parseDelegation, parseIdentityManifest, verifyDataManifestPages } from './manifests';
import { parsePublicKey, validateProfile, verifyTranscript } from './pgp';
import type { Entry, Product } from './productBundle';
import { openProductBundle, sealProductBundle } from './productBundle';
import { PROFILE } from './profiles';
import { openAuthority, openRootDescriptor } from './secretBundle';

const DIGEST = '8586cb12681b77f101eff0ec79ab802c7afe88f45ba0b1cae68ecca867024086';

interface Header {
	accountId: string;
	product?: Product;
	productKeyEpoch?: number;
	amkEpoch?: number;
	bundleId: string;
	revision: number;
}

interface BundleVector {
	name: string;
	key: string;
	forbidden: string[] | null;
	header: Header;
	kind?: string;
	envelope: string;
	plaintext?: unknown;
	error?: string;
}

interface SignedVector {
	name: string;
	record?: string;
	pages?: string[];
	signature?: string;
	signatures?: string[];
	signerKey: string;
	hash?: string;
	error?: string;
}

interface HeadVector {
	name: string;
	kind: 'bootstrap' | 'successor';
	amk: string;
	accountId: string;
	previous?: string;
	previousHeadHash: string | null;
	head: string;
	hash: string;
	mac: string;
	authoritySignature: string | null;
	legacySignature: string | null;
	transitionSignature: string | null;
	authorityKey: string | null;
	previousAuthorityKey: string | null;
	legacyKey: string | null;
	minimumAuthorityEpoch: number;
	error?: string;
}

const vectors = JSON.parse(raw) as {
	productBundles: BundleVector[];
	secretBundles: BundleVector[];
	identityManifests: SignedVector[];
	dataManifests: SignedVector[];
	delegations: SignedVector[];
	heads: HeadVector[];
};

const bytes = (s: string | null | undefined) => (s ? b64decode(s) : null);

async function expectCode(name: string, code: string | undefined, run: () => Promise<unknown>) {
	try {
		await run();
	} catch (err) {
		if (!code) throw new Error(`${name}: ${String(err)}`);
		expect(err, name).toBeInstanceOf(ProductKeysError);
		expect((err as ProductKeysError).code, `${name}: ${String(err)}`).toBe(code);
		return;
	}
	if (code) throw new Error(`${name}: expected ${code}`);
}

function entriesJson(entries: Entry[]) {
	return entries.map((e) => ({ ...e, material: e.material ? b64encode(e.material) : null }));
}

describe('product-keys-v1 vectors', () => {
	it('is the file platform pins', async () => {
		const sum = await sha256(utf8(raw));
		expect(Array.from(sum, (b) => b.toString(16).padStart(2, '0')).join('')).toBe(DIGEST);
	});

	it('opens and refuses product bundles exactly as platform does', async () => {
		for (const v of vectors.productBundles) {
			const header = {
				accountId: v.header.accountId,
				product: v.header.product as Product,
				productKeyEpoch: v.header.productKeyEpoch ?? 0,
				bundleId: v.header.bundleId,
				revision: v.header.revision
			};
			const forbidden = (v.forbidden ?? []).map(b64decode);
			await expectCode(v.name, v.error, async () => {
				const entries = await openProductBundle(b64decode(v.key), utf8(v.envelope), header, forbidden);
				expect(entriesJson(entries), v.name).toEqual(v.plaintext);
				const resealed = await sealProductBundle(b64decode(v.key), header, entries, forbidden);
				expect(entriesJson(await openProductBundle(b64decode(v.key), resealed, header, forbidden))).toEqual(v.plaintext);
			});
		}
	});

	it('opens and refuses secret bundles exactly as platform does', async () => {
		for (const v of vectors.secretBundles) {
			const header = { accountId: v.header.accountId, amkEpoch: v.header.amkEpoch ?? 0, bundleId: v.header.bundleId, revision: v.header.revision };
			await expectCode(v.name, v.error, async () => {
				if (v.kind === 'root') {
					const d = await openRootDescriptor(b64decode(v.key), utf8(v.envelope), header);
					expect({ ...d, productRoot: b64encode(d.productRoot), identityManifestHash: b64encode(d.identityManifestHash) }).toEqual(v.plaintext);
				} else {
					const a = await openAuthority(b64decode(v.key), utf8(v.envelope), header);
					expect({ authorityKeyId: a.authorityKeyId, authorityEpoch: a.authorityEpoch, secretKey: b64encode(a.secretKey) }).toEqual(v.plaintext);
				}
			});
		}
	});

	it('verifies identity manifests and delegations', async () => {
		for (const [domain, list, parse] of [
			[DOMAIN.identityManifest, vectors.identityManifests, parseIdentityManifest],
			[DOMAIN.delegation, vectors.delegations, parseDelegation]
		] as const) {
			for (const v of list) {
				await expectCode(v.name, v.error, async () => {
					const record = utf8(v.record ?? '');
					parse(record);
					await verifyTranscript(domain, record, bytes(v.signature) ?? new Uint8Array(), await parsePublicKey(b64decode(v.signerKey)));
					expect(b64encode(await transcriptHash(domain, record))).toBe(v.hash);
				});
			}
		}
	});

	it('verifies paged data manifests', async () => {
		for (const v of vectors.dataManifests) {
			await expectCode(v.name, v.error, async () => {
				const pages = (v.pages ?? []).map(utf8);
				await verifyDataManifestPages(pages);
				const signer = await parsePublicKey(b64decode(v.signerKey));
				for (let i = 0; i < pages.length; i++) {
					parseDataManifest(pages[i]);
					await verifyTranscript(DOMAIN.dataManifest, pages[i], b64decode((v.signatures ?? [])[i]), signer);
				}
			});
		}
	});

	it('enforces the head transition rules', async () => {
		for (const v of vectors.heads) {
			const sigs: HeadSignatures = { authority: bytes(v.authoritySignature), legacy: bytes(v.legacySignature), transition: bytes(v.transitionSignature) };
			await expectCode(v.name, v.error, async () => {
				const authority = await parsePublicKey(b64decode(v.authorityKey ?? ''));
				if (v.kind === 'bootstrap') {
					const legacy = await openpgp.readKey({ binaryKey: b64decode(v.legacyKey ?? '') });
					await verifyBootstrap(utf8(v.head), bytes(v.previousHeadHash), sigs, authority, legacy);
				} else {
					const previous = await parsePublicKey(b64decode(v.previousAuthorityKey ?? ''));
					await verifySuccessor(utf8(v.previous ?? ''), utf8(v.head), sigs, authority, previous, v.minimumAuthorityEpoch);
				}
				await verifyHeadMac(b64decode(v.amk), v.accountId, utf8(v.head), b64decode(v.mac));
			});
			expect(b64encode(await headHash(utf8(v.head))), v.name).toBe(v.hash);
		}
	});

	it('admits keys only under their own profile', async () => {
		const aak = await parsePublicKey(b64decode(vectors.heads[0].authorityKey ?? ''));
		await validateProfile(PROFILE.accountAuthority, aak);
		await expectCode('authority as calendar', 'profile', () => validateProfile(PROFILE.calendarIdentity, aak));
		const cal = await parsePublicKey(b64decode(vectors.dataManifests[0].signerKey));
		await validateProfile(PROFILE.calendarIdentity, cal);
		await expectCode('calendar as authority', 'profile', () => validateProfile(PROFILE.accountAuthority, cal));
	});
});
