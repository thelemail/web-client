import { encodeCanonical } from '../productkeys/canonical';
import { requireUuid } from '../productkeys/encoding';
import { deriveSecret, SALT_LEN, SECRET_LEN } from '../productkeys/envelope';
import { fail } from '../productkeys/errors';

const TYPE = 'thelemail-search-db/v1';
const INFO = 'thelemail/search-db/v1';

export async function searchDbKey(root: Uint8Array, accountId: string, generationId: string, installationSalt: Uint8Array): Promise<Uint8Array> {
	if (root.length !== SECRET_LEN) fail('malformed', 'search root length');
	if (!(installationSalt instanceof Uint8Array) || installationSalt.length !== SALT_LEN) fail('malformed', 'installation salt length');
	const aad = encodeCanonical({ type: TYPE, accountId: requireUuid(accountId), generationId: requireUuid(generationId) });
	return deriveSecret(root, installationSalt, INFO, aad);
}
