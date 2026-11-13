import { randomUuid, requireUuid } from '../productkeys/encoding';
import { randomBytes, SECRET_LEN } from '../productkeys/envelope';
import { fail } from '../productkeys/errors';
import { ENTRY, openProductBundle, parseProductBundle, sealProductBundle } from '../productkeys/productBundle';
import { PROFILE } from '../productkeys/profiles';

export interface SearchRoot {
	generationId: string;
	bundleId: string;
	root: Uint8Array;
}

export async function sealSearchRoot(
	productRoot: Uint8Array,
	accountId: string,
	productKeyEpoch: number,
	forbidden: Uint8Array[]
): Promise<{ searchRoot: SearchRoot; bundle: Uint8Array }> {
	const searchRoot: SearchRoot = { generationId: randomUuid(), bundleId: randomUuid(), root: randomBytes(SECRET_LEN) };
	const bundle = await sealProductBundle(
		productRoot,
		{ accountId, product: 'app', productKeyEpoch, bundleId: searchRoot.bundleId, revision: 1 },
		[
			{
				keyId: randomUuid(),
				scopeId: searchRoot.generationId,
				purpose: ENTRY.mailSearchRoot,
				profileId: PROFILE.mailSearchRoot,
				keyEpoch: 1,
				availability: 'available',
				material: searchRoot.root
			}
		],
		forbidden
	);
	return { searchRoot, bundle };
}

export async function openSearchRoot(
	productRoot: Uint8Array,
	raw: Uint8Array,
	accountId: string,
	productKeyEpoch: number,
	forbidden: Uint8Array[]
): Promise<SearchRoot> {
	const h = parseProductBundle(raw);
	if (h.accountId !== accountId || h.product !== 'app' || h.productKeyEpoch !== productKeyEpoch || h.revision !== 1) fail('context');
	const entries = await openProductBundle(productRoot, raw, h, forbidden);
	const e = entries[0];
	if (entries.length !== 1 || e.purpose !== ENTRY.mailSearchRoot || e.keyEpoch !== 1 || !e.material) {
		fail('malformed', 'not a search root bundle');
	}
	return { generationId: requireUuid(e.scopeId), bundleId: h.bundleId, root: e.material };
}
