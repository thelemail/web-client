import * as openpgp from 'openpgp';

export function isProductIdentity(key: openpgp.Key): boolean {
	const p = key.keyPacket;
	return p.version === 6 && p.algorithm === openpgp.enums.publicKey.ed25519 && key.getUserIDs().length === 0;
}
