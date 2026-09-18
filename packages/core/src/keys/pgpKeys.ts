import * as openpgp from 'openpgp';

export const V6_KEY_CONFIG: openpgp.PartialConfig = { v6Keys: true, aeadProtect: true };

export interface GenerateKeyOptions {
	userIDs: openpgp.UserID[];
	date: Date;
	subkeys?: openpgp.SubkeyOptions[];
	keyExpirationTime?: number;
}

export function generateCurve25519Key(options: GenerateKeyOptions) {
	return openpgp.generateKey({
		type: 'curve25519',
		...options,
		format: 'object',
		config: V6_KEY_CONFIG
	});
}

function configFor(key: openpgp.Key): openpgp.PartialConfig | undefined {
	return key.keyPacket.version === 6 ? V6_KEY_CONFIG : undefined;
}

export function lockKey(privateKey: openpgp.PrivateKey, passphrase: string) {
	return openpgp.encryptKey({ privateKey, passphrase, config: configFor(privateKey) });
}

export function reformatWithUserIDs(privateKey: openpgp.PrivateKey, userIDs: openpgp.UserID[]) {
	return openpgp.reformatKey({ privateKey, userIDs, format: 'object', config: configFor(privateKey) });
}
