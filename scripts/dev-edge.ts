import type { ProxyOptions } from 'vite';

const productHostHeader = 'X-Thelemail-Host';

export function devEdge(): Record<string, ProxyOptions> {
	const target = process.env.THELEMAIL_DEV_API ?? 'http://localhost:8180';
	return {
		'/v1': {
			target,
			changeOrigin: false,
			xfwd: false,
			configure: (proxy) => {
				proxy.on('proxyReq', (proxyReq, req) => {
					proxyReq.removeHeader(productHostHeader);
					if (req.headers.host) proxyReq.setHeader(productHostHeader, req.headers.host);
				});
			}
		}
	};
}
