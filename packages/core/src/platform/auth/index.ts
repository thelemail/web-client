import type { Platform } from '../types';
import { webPlatform } from '../web/base';

export const platform: Platform = {
	...webPlatform,
	spawnKeystore: () =>
		new SharedWorker(new URL('../../keystore/auth-worker.ts', import.meta.url), {
			type: 'module',
			name: 'thelemail-auth-keystore'
		})
};
