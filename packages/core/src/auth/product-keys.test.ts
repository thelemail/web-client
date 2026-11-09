// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('$core/api/productKeys', () => ({}));
vi.mock('$core/api/me', () => ({}));
vi.mock('$core/api/aliases', () => ({}));

import type { AliasKeyGrant } from '$core/api/aliases';
import type { CryptoStateResponse } from '$core/api/productKeys';
import type { AccountKeyListResponse } from '$core/api/types';
import { textToB64 } from '$core/keys/encode';
import { buildConversion, stripUserIds } from '$core/keystore/productkeys/convert';
import { b64encode, keyId, sha256 } from '$core/keystore/productkeys/encoding';
import { fingerprintBytes } from '$core/keystore/productkeys/pgp';
import { conversionArgs } from './product-keys';

const accountId = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const aliasRowId = '367ac1f8-1611-4016-b6ea-f9149d05ac0a';
const aliasAccountId = '4785aa68-150e-42fe-8cc5-23010fd08aae';
const keyPassword = 'cGFzc3BocmFzZS1mb3ItdGVzdHMtb25seQ==';

function event(type: string, k: { keyId: string; epoch: number; hash: Uint8Array; bytes: Uint8Array }) {
	return new TextEncoder().encode(
		JSON.stringify({
			eventType: type,
			keyId: k.keyId,
			keyEpoch: k.epoch,
			profileId: 'mail-classic-v1',
			publicKeyHash: b64encode(k.hash),
			eventPayload: { publicKeyBytes: b64encode(k.bytes), proofOfPossession: '' }
		})
	);
}

describe('conversion arguments from API responses', () => {
	it('opens alias grants as the API serves them and scopes them to the alias account', async () => {
		const { privateKey: locked } = await openpgp.generateKey({
			type: 'curve25519',
			userIDs: [{ email: 'calloway@thelemail.test' }],
			passphrase: keyPassword,
			format: 'object',
			config: { v6Keys: true }
		});
		const unlocked = await openpgp.decryptKey({ privateKey: locked, passphrase: keyPassword });
		const { privateKey: alias } = await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'frontdesk@thelemail.test' }], format: 'object', config: { v6Keys: true } });
		const wrapped = (await openpgp.encrypt({ message: await openpgp.createMessage({ text: alias.armor() }), encryptionKeys: unlocked.toPublic() })) as string;

		const stripped = stripUserIds(locked);
		const mine = { keyId: keyId(accountId, fingerprintBytes(locked)), epoch: 1, hash: await sha256(stripped), bytes: stripped };
		const state: CryptoStateResponse = {
			scope: {
				scopeType: 'account',
				scopeId: accountId,
				stateRevision: 0,
				activeKeyEpoch: 1,
				activeGeneration: 1,
				authEpoch: 1,
				recoveryEpoch: 1,
				amkEpoch: 1,
				minimumWriteProfile: null,
				historyEventCount: 2,
				keyHistoryRoot: b64encode(new Uint8Array(32).fill(9))
			},
			sessionEpoch: 0,
			head: null,
			credentials: [{ credentialId: aliasRowId, method: 'password', state: 'active', recordHash: b64encode(new Uint8Array(32).fill(1)) }],
			slots: [{ slotId: aliasRowId, kind: 'password', state: 'active', wrapperHash: b64encode(new Uint8Array(32).fill(2)) }],
			bundles: [],
			keys: [{ keyId: mine.keyId, privateState: 'available' }],
			history: { start: 1, end: 2, predecessor: '', events: [], nextCursor: null },
			features: { productKeys: true }
		};
		const keys: AccountKeyListResponse = {
			currentVersion: 1,
			keys: [{ keyVersion: 1, keyFingerprint: '', keyAlgorithm: 'openpgp-curve25519-v6', publicKeyArmored: locked.toPublic().armor(), encryptedPrivateKey: locked.armor(), isCurrent: true, transitions: [] }]
		};
		const grants: AliasKeyGrant[] = [
			{
				aliasId: aliasRowId,
				aliasAccountId,
				addressId: aliasRowId,
				email: 'frontdesk@thelemail.test',
				name: 'Front desk',
				keyVersion: 2,
				aliasKeyFingerprint: '',
				aliasPublicKeyArmored: alias.toPublic().armor(),
				wrappedPrivateKey: textToB64(wrapped),
				isCurrent: true
			}
		];

		const args = conversionArgs(accountId, state, [event('introduced', mine), event('activated', mine)], keys, grants);
		expect(args.aliasKeys).toEqual([{ aliasId: aliasAccountId, keyVersion: 2, wrappedPrivateKey: wrapped }]);
		expect(args.credentialHashes).toHaveLength(1);
		expect(args.slotHashes).toHaveLength(1);

		const out = await buildConversion({
			...args,
			amk: crypto.getRandomValues(new Uint8Array(32)),
			keyPassword,
			history: (await import('$core/keystore/productkeys/convert')).historyKeys(args.historyEvents),
			availability: new Map(args.availability.map((a) => [a.keyId, a.state]))
		});
		const manifest = JSON.parse(new TextDecoder().decode(out.identityManifests.find((m) => m.product === 'app')!.record));
		const aliasKey = manifest.identityKeys.find((k: { usage: string }) => k.usage === 'mail-alias');
		expect(aliasKey.keyId).toBe(keyId(aliasAccountId, fingerprintBytes(alias)));
		expect(aliasKey.keyEpoch).toBe(2);
	});
});
