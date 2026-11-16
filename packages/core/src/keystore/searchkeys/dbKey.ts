import { encodeCanonical } from '../productkeys/canonical';
import { requireUuid } from '../productkeys/encoding';
import { deriveSecret, SALT_LEN, SECRET_LEN } from '../productkeys/envelope';
import { fail } from '../productkeys/errors';

const DB = { type: 'thelemail-search-db/v1', info: 'thelemail/search-db/v1' };
const HISTORY = { type: 'thelemail-search-history/v1', info: 'thelemail/search-history/v1' };

async function installationKey(
	purpose: { type: string; info: string },
	root: Uint8Array,
	accountId: string,
	generationId: string,
	installationSalt: Uint8Array
): Promise<Uint8Array> {
	if (root.length !== SECRET_LEN) fail('malformed', 'search root length');
	if (!(installationSalt instanceof Uint8Array) || installationSalt.length !== SALT_LEN) fail('malformed', 'installation salt length');
	const aad = encodeCanonical({ type: purpose.type, accountId: requireUuid(accountId), generationId: requireUuid(generationId) });
	return deriveSecret(root, installationSalt, purpose.info, aad);
}

export function searchDbKey(root: Uint8Array, accountId: string, generationId: string, installationSalt: Uint8Array): Promise<Uint8Array> {
	return installationKey(DB, root, accountId, generationId, installationSalt);
}

export function searchHistoryKey(root: Uint8Array, accountId: string, generationId: string, installationSalt: Uint8Array): Promise<Uint8Array> {
	return installationKey(HISTORY, root, accountId, generationId, installationSalt);
}
