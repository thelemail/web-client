const HEADER_SPLIT = /\r?\n\r?\n/;

function splitPart(raw: string): { headers: string; body: string } {
	const m = HEADER_SPLIT.exec(raw);
	if (!m) return { headers: raw, body: '' };
	return { headers: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}

function headerValue(headers: string, name: string): string {
	const unfolded = headers.replace(/\r?\n[ \t]+/g, ' ');
	for (const line of unfolded.split(/\r?\n/)) {
		const colon = line.indexOf(':');
		if (colon <= 0) continue;
		if (line.slice(0, colon).trim().toLowerCase() === name) return line.slice(colon + 1).trim();
	}
	return '';
}

function param(value: string, name: string): string {
	const re = new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, 'i');
	return re.exec(value)?.[1]?.trim() ?? '';
}

export function isPgpEncryptedMime(mime: string): boolean {
	const { headers } = splitPart(mime);
	const ct = headerValue(headers, 'content-type');
	if (!ct.toLowerCase().startsWith('multipart/encrypted')) return false;
	const protocol = param(ct, 'protocol').toLowerCase();
	return protocol === '' || protocol === 'application/pgp-encrypted';
}

export function extractPgpArmor(mime: string): string | null {
	const { headers, body } = splitPart(mime);
	const ct = headerValue(headers, 'content-type');
	if (!ct.toLowerCase().startsWith('multipart/encrypted')) return null;
	const boundary = param(ct, 'boundary');
	if (!boundary) return null;
	for (const seg of body.split(`--${boundary}`)) {
		if (seg.startsWith('--')) break;
		if (!seg.trim()) continue;
		const part = splitPart(seg.replace(/^\r?\n/, ''));
		const pct = headerValue(part.headers, 'content-type').toLowerCase();
		if (pct.startsWith('application/pgp-encrypted')) continue;
		let text = part.body;
		const cte = headerValue(part.headers, 'content-transfer-encoding').toLowerCase().trim();
		if (cte === 'base64') {
			try {
				text = atob(text.replace(/\s/g, ''));
			} catch {
				continue;
			}
		}
		const begin = text.indexOf('-----BEGIN PGP MESSAGE-----');
		if (begin < 0) continue;
		const endMarker = '-----END PGP MESSAGE-----';
		const end = text.indexOf(endMarker, begin);
		if (end < 0) return null;
		return text.slice(begin, end + endMarker.length);
	}
	return null;
}
