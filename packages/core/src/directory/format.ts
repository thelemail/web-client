import { intlLocale } from '$core/i18n/intl';

function groups(clean: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < clean.length; i += 4) out.push(clean.slice(i, i + 4));
	return out;
}

export function formatFingerprintHex(hex: string): string {
	const clean = hex.replace(/\s+/g, '').toUpperCase();
	if (clean.length === 0) return '';
	const g = groups(clean);
	if (g.length <= 1) return g.join('');
	const mid = Math.ceil(g.length / 2);
	return g.slice(0, mid).join(' ') + ' · ' + g.slice(mid).join(' ');
}

export function keyIdHex(fingerprintHex: string): string {
	const clean = fingerprintHex.replace(/\s+/g, '').toLowerCase();
	if (clean.length === 64) return clean.slice(0, 16);
	if (clean.length === 40) return clean.slice(-16);
	return clean;
}

export function formatKeyId(fingerprintHex: string): string {
	return groups(keyIdHex(fingerprintHex).toUpperCase()).join(' ');
}

export function formatDay(timestampMillis: number): string {
	const date = new Date(timestampMillis);
	const day = String(date.getUTCDate()).padStart(2, '0');
	const month = date.toLocaleString(intlLocale('en-GB'), { month: 'short', timeZone: 'UTC' });
	return `${day} ${month} ${date.getUTCFullYear()}`;
}

export function formatVerifiedAt(timestampMillis: number, version: number): string {
	return `${formatDay(timestampMillis)} · v${version}`;
}
