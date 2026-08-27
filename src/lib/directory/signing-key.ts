import { PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED } from '$env/static/public';
import * as openpgp from 'openpgp';

if (!PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED) {
	throw new Error(
		'PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED is not set. ' +
			'Set it to the armored OpenPGP public key of the directory signer ' +
			'(see web-client/.env.example).'
	);
}

export const DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED = PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED;

const _signingKey = await openpgp.readKey({ armoredKey: DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED });
const _fp = _signingKey.getFingerprint();
export const DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX =
	typeof _fp === 'string'
		? _fp.toLowerCase()
		: Array.from(new Uint8Array(_fp as ArrayLike<number>), (b) =>
				b.toString(16).padStart(2, '0')
			).join('');
