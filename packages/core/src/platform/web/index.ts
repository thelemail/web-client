import type { Platform } from '../types';

export const platform: Platform = {
	reportError: undefined,
	interceptFrameLinks: false,
	writeFrameDoc: false,
	session: undefined,
	notifications: undefined,
	billing: 'native',
	mirror: undefined,
	keystoreChannel: undefined,
	transport: undefined,
	openEventSource: undefined,
	blobFetch: (url, init) => fetch(url, init),
	blobPut: (url, body, contentType, opts) =>
		new Promise<Response>((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', url, true);
			if (contentType) xhr.setRequestHeader('Content-Type', contentType);
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable && e.total > 0) opts?.onProgress?.(e.loaded / e.total);
			};
			xhr.onload = () => resolve(new Response(null, { status: xhr.status }));
			xhr.onerror = () => reject(new Error('network error during upload'));
			xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
			opts?.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
			xhr.send(body);
		}),
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
