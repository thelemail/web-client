import type { Platform } from '../types';
import { webPlatform } from './base';

export const platform: Platform = {
	...webPlatform,
	spawnKeystore: () =>
		new SharedWorker(new URL('../../keystore/keystore-worker.ts', import.meta.url), {
			type: 'module',
			name: 'thelemail-keystore'
		})
};
