import * as openpgp from 'openpgp';
import { fingerprintHexOf } from './key-transition';

export interface ArmoredKeySummary {
	fingerprintHex: string;
	userIds: string[];
}

export async function inspectArmoredKey(armored: string): Promise<ArmoredKeySummary | null> {
	let key: openpgp.Key;
	try {
		key = await openpgp.readKey({ armoredKey: armored.trim() });
	} catch {
		return null;
	}
	if (key.isPrivate()) return null;
	return { fingerprintHex: fingerprintHexOf(key), userIds: key.getUserIDs() };
}
