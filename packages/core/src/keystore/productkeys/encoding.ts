import { sha1 } from '@noble/hashes/legacy.js';
import { fail } from './errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuid(s: unknown): s is string {
	return typeof s === 'string' && UUID_RE.test(s);
}

export function requireUuid(s: unknown): string {
	if (!isCanonicalUuid(s)) fail('malformed', 'noncanonical uuid');
	return s;
}

export function uuidBytes(s: string): Uint8Array {
	const hex = requireUuid(s).replaceAll('-', '');
	const out = new Uint8Array(16);
	for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

function formatUuid(b: Uint8Array): string {
	const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidV5(namespace: string, name: Uint8Array): string {
	const input = new Uint8Array(16 + name.length);
	input.set(uuidBytes(namespace));
	input.set(name, 16);
	const h = sha1(input).slice(0, 16);
	h[6] = (h[6] & 0x0f) | 0x50;
	h[8] = (h[8] & 0x3f) | 0x80;
	return formatUuid(h);
}

const KEY_ID_NAMESPACE = '7d0f1c56-3b0e-5a8e-9b57-2f6b4a0c1e11';

export function keyId(scopeId: string, fingerprint: Uint8Array): string {
	const name = new Uint8Array(16 + fingerprint.length);
	name.set(uuidBytes(scopeId));
	name.set(fingerprint, 16);
	return uuidV5(KEY_ID_NAMESPACE, name);
}

export function randomUuid(): string {
	return crypto.randomUUID();
}

export function b64encode(b: Uint8Array): string {
	let s = '';
	for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
	return btoa(s);
}

export function b64decode(s: unknown): Uint8Array {
	if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) {
		fail('malformed', 'noncanonical base64');
	}
	let bin: string;
	try {
		bin = atob(s);
	} catch {
		fail('malformed', 'noncanonical base64');
	}
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	if (b64encode(out) !== s) fail('malformed', 'noncanonical base64');
	return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return a.length - b.length;
}

export async function sha256(b: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
