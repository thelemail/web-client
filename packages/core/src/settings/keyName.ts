import { m } from '$paraglide/messages.js';
import { i18n } from '$core/i18n/locale.svelte';

export const KEY_NAME_MAX_LENGTH = 64;

export interface UserAgentSource {
	userAgent: string;
	userAgentData?: { platform?: string };
}

const hintedPlatforms: Record<string, string> = {
	macOS: 'Mac',
	Windows: 'Windows',
	Android: 'Android',
	Linux: 'Linux',
	'Chrome OS': 'ChromeOS',
	ChromeOS: 'ChromeOS',
	iOS: 'iPhone'
};

export function deviceOf(source: UserAgentSource): string | null {
	const hinted = source.userAgentData?.platform;
	if (hinted && hintedPlatforms[hinted]) return hintedPlatforms[hinted];
	const ua = source.userAgent;
	if (/iPad/.test(ua)) return 'iPad';
	if (/iPhone|iPod/.test(ua)) return 'iPhone';
	if (/Android/.test(ua)) return 'Android';
	if (/CrOS/.test(ua)) return 'ChromeOS';
	if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
	if (/Windows/.test(ua)) return 'Windows';
	if (/Linux/.test(ua)) return 'Linux';
	return null;
}

export function browserOf(source: UserAgentSource): string | null {
	const ua = source.userAgent;
	if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
	if (/OPR\/|Opera/.test(ua)) return 'Opera';
	if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
	if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
	if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
	if (/Version\/[\d.]+.*Safari\//.test(ua)) return 'Safari';
	return null;
}

function clamp(name: string): string {
	return [...name].slice(0, KEY_NAME_MAX_LENGTH).join('').trim();
}

export function defaultKeyName(
	method: 'device' | 'key',
	now: Date = new Date(),
	source: UserAgentSource = navigator
): string {
	const date = now.toLocaleDateString(i18n.tag, { year: 'numeric', month: 'short', day: 'numeric' });
	if (method === 'key') return clamp(m.settings_key_name_security_key({ date }));
	const device = deviceOf(source);
	const browser = browserOf(source);
	if (device && browser) return clamp(m.settings_key_name_device_browser({ device, browser, date }));
	if (device) return clamp(m.settings_key_name_device({ device, date }));
	return clamp(m.settings_key_name_passkey({ date }));
}
