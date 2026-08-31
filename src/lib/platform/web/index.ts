import type { Platform } from '../types';

export const platform: Platform = {
	interceptFrameLinks: false,
	session: undefined,
	billing: 'native',
	mirror: undefined,
	keystoreChannel: undefined,
	transport: undefined,
	openEventSource: undefined,
	blobFetch: (url, init) => fetch(url, init),
	returnOrigin: () => window.location.origin,
	openExternal: (url) => window.location.assign(url),
	saveBlob: async (blob, filename) => {
		const href = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = href;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(href);
	}
};
