import { dev } from '$app/env';
import type { Platform } from '../types';
import { webPlatform } from '../web/base';
import { createVaultDeviceKeys } from './vault-device-key';

interface TrustedTypePolicyFactoryLike {
	createPolicy(name: string, rules: { createScriptURL(url: string): string }): unknown;
}

export function sameOriginScriptURL(url: string, origin: string, allowDevPaths: boolean): string {
	const parsed = new URL(url, origin);
	if (parsed.origin !== origin) {
		throw new TypeError(`script url outside ${origin} refused`);
	}
	if (!allowDevPaths && !parsed.pathname.startsWith('/_app/immutable/')) {
		throw new TypeError(`script url ${parsed.pathname} is not a built asset`);
	}
	return parsed.href;
}

const factory = (globalThis as { trustedTypes?: TrustedTypePolicyFactoryLike }).trustedTypes;
if (factory && typeof location !== 'undefined') {
	const origin = location.origin;
	factory.createPolicy('default', {
		createScriptURL: (url) => sameOriginScriptURL(url, origin, dev)
	});
}

export const platform: Platform = {
	...webPlatform,
	spawnKeystore: () =>
		new SharedWorker(new URL('../../keystore/auth-worker.ts', import.meta.url), {
			type: 'module',
			name: 'thelemail-auth-keystore'
		}),
	vaultDeviceKeys: createVaultDeviceKeys()
};
