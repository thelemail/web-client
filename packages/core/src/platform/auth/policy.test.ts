import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ dev: false, browser: true }));

import { sameOriginScriptURL } from './index';

const origin = 'https://auth.thelemail.com';

describe('auth script url policy', () => {
	it('admits built worker assets on its own origin', () => {
		expect(sameOriginScriptURL('/_app/immutable/workers/auth-worker-x.js', origin, false)).toBe(
			'https://auth.thelemail.com/_app/immutable/workers/auth-worker-x.js'
		);
	});

	it('refuses other origins, even sibling products', () => {
		for (const url of [
			'https://app.thelemail.com/_app/immutable/workers/keystore-worker-x.js',
			'https://evil.test/_app/immutable/x.js',
			'data:text/javascript,alert(1)',
			'blob:https://auth.thelemail.com/1234'
		]) {
			expect(() => sameOriginScriptURL(url, origin, false), url).toThrow();
		}
	});

	it('refuses same-origin paths outside the built assets', () => {
		expect(() => sameOriginScriptURL('/v1/me', origin, false)).toThrow();
		expect(() => sameOriginScriptURL('/index.html', origin, false)).toThrow();
	});

	it('lets the dev server load its module paths on the same origin', () => {
		expect(sameOriginScriptURL('/@fs/x/auth-worker.ts?worker_file', origin, true)).toContain(origin);
		expect(() => sameOriginScriptURL('https://evil.test/x.js', origin, true)).toThrow();
	});
});
