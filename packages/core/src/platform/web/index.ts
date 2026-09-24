import type { Platform } from '../types';
import { readLocaleCookie, writeLocaleCookie } from '../../i18n/cookie';
import { m } from '$paraglide/messages.js';

export const platform: Platform = {
	reportError: undefined,
	interceptFrameLinks: false,
	writeFrameDoc: false,
	session: undefined,
	notifications: undefined,
	billing: 'native',
	locale: {
		saved: () => readLocaleCookie(document.cookie),
		save: (locale) => writeLocaleCookie(locale),
		preferred: async () => navigator.languages ?? [navigator.language]
	},
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
			xhr.onerror = () => reject(new Error(m.platform_upload_network_error()));
			xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
			opts?.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
			xhr.send(body);
		}),
	submissionUpload: (url, body, headers, opts) =>
		new Promise<Response>((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', url, true);
			xhr.withCredentials = true;
			for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable && e.total > 0) opts?.onProgress?.(e.loaded / e.total);
			};
			xhr.onload = () =>
				resolve(
					new Response(xhr.responseText, {
						status: xhr.status,
						headers: {
							'content-type': xhr.getResponseHeader('content-type') ?? '',
							date: xhr.getResponseHeader('date') ?? ''
						}
					})
				);
			xhr.onerror = () => reject(new Error(m.platform_upload_network_error()));
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
