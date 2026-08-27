export function formatFingerprintHex(hex: string): string {
	const clean = hex.replace(/\s+/g, '').toUpperCase();
	if (clean.length === 0) return '';
	const groups: string[] = [];
	for (let i = 0; i < clean.length; i += 4) {
		groups.push(clean.slice(i, i + 4));
	}
	if (groups.length <= 1) return groups.join('');
	const mid = Math.ceil(groups.length / 2);
	return groups.slice(0, mid).join(' ') + ' · ' + groups.slice(mid).join(' ');
}

export function formatVerifiedAt(timestampMillis: number, version: number): string {
	const date = new Date(timestampMillis);
	const day = String(date.getUTCDate()).padStart(2, '0');
	const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
	const year = date.getUTCFullYear();
	return `${day} ${month} ${year} · v${version}`;
}
