import { describe, expect, it } from 'vitest';
import { browserOf, defaultKeyName, deviceOf, KEY_NAME_MAX_LENGTH } from './keyName';

const ua = {
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
	macChrome:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
	winEdge:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
	linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
	iphoneSafari:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
	ipadChrome:
		'Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
	androidChrome:
		'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
	chromebook:
		'Mozilla/5.0 (X11; CrOS x86_64 16181.61.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
	macWebview: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'
};

const day = new Date('2026-10-20T12:00:00Z');

describe('deviceOf and browserOf', () => {
	it.each([
		[ua.macSafari, 'Mac', 'Safari'],
		[ua.macChrome, 'Mac', 'Chrome'],
		[ua.winEdge, 'Windows', 'Edge'],
		[ua.linuxFirefox, 'Linux', 'Firefox'],
		[ua.iphoneSafari, 'iPhone', 'Safari'],
		[ua.ipadChrome, 'iPad', 'Chrome'],
		[ua.androidChrome, 'Android', 'Chrome'],
		[ua.chromebook, 'ChromeOS', 'Chrome'],
		[ua.macWebview, 'Mac', null]
	])('reads %s', (userAgent, device, browser) => {
		expect(deviceOf({ userAgent })).toBe(device);
		expect(browserOf({ userAgent })).toBe(browser);
	});

	it('prefers the client hint platform', () => {
		expect(deviceOf({ userAgent: ua.linuxFirefox, userAgentData: { platform: 'macOS' } })).toBe('Mac');
	});

	it('knows nothing about an unrecognised agent', () => {
		expect(deviceOf({ userAgent: 'curl/8.0' })).toBeNull();
		expect(browserOf({ userAgent: 'curl/8.0' })).toBeNull();
	});
});

describe('defaultKeyName', () => {
	it('names a passkey after the device, browser and date', () => {
		expect(defaultKeyName('device', day, { userAgent: ua.macSafari })).toBe('Mac, Safari · Oct 20, 2026');
	});

	it('drops the browser when it is unknown', () => {
		expect(defaultKeyName('device', day, { userAgent: ua.macWebview })).toBe('Mac · Oct 20, 2026');
	});

	it('falls back to a dated passkey', () => {
		expect(defaultKeyName('device', day, { userAgent: 'curl/8.0' })).toBe('Passkey · Oct 20, 2026');
	});

	it('names a security key with the date only', () => {
		expect(defaultKeyName('key', day, { userAgent: ua.macSafari })).toBe('Security key · Oct 20, 2026');
	});

	it('never names a key the old fixed way', () => {
		for (const method of ['device', 'key'] as const) {
			const name = defaultKeyName(method, day, { userAgent: ua.winEdge });
			expect(name).not.toBe('This device');
			expect(name).not.toBe('Security key');
			expect([...name].length).toBeLessThanOrEqual(KEY_NAME_MAX_LENGTH);
		}
	});
});
