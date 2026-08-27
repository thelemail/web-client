const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function bytesFromBase64(b64: string): Uint8Array {
	if (!BASE64_RE.test(b64) || b64.length % 4 !== 0) {
		throw new Error('invalid base64');
	}
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
	let s = '';
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

export function utf8(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
	let offset = 0;
	for (const a of arrays) {
		out.set(a, offset);
		offset += a.length;
	}
	return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

export function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
