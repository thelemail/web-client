import { fail } from './errors';

export const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_DEPTH = 32;

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8(s: string): Uint8Array {
	return encoder.encode(s);
}

class Parser {
	pos = 0;
	constructor(readonly src: string) {}

	space() {
		while (this.pos < this.src.length) {
			const c = this.src[this.pos];
			if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') return;
			this.pos++;
		}
	}

	value(depth: number): Json {
		if (depth > MAX_DEPTH) fail('malformed', 'nesting too deep');
		const c = this.src[this.pos];
		if (c === '{') return this.object(depth);
		if (c === '[') return this.array(depth);
		if (c === '"') return this.string();
		if (c === '-' || (c >= '0' && c <= '9')) return this.number();
		for (const [word, v] of [
			['true', true],
			['false', false],
			['null', null]
		] as const) {
			if (this.src.startsWith(word, this.pos)) {
				this.pos += word.length;
				return v;
			}
		}
		fail('malformed', `unexpected character at ${this.pos}`);
	}

	number(): number {
		const start = this.pos;
		if (this.src[this.pos] === '-') this.pos++;
		const digits = this.pos;
		while (this.pos < this.src.length && this.src[this.pos] >= '0' && this.src[this.pos] <= '9') this.pos++;
		if (this.pos === digits) fail('malformed', 'bad number');
		if (this.src[digits] === '0' && this.pos - digits > 1) fail('malformed', 'leading zero');
		const next = this.src[this.pos];
		if (next === '.' || next === 'e' || next === 'E') fail('malformed', 'number is not a safe integer');
		const n = Number(this.src.slice(start, this.pos));
		if (!Number.isSafeInteger(n)) fail('malformed', 'number is not a safe integer');
		return n;
	}

	string(): string {
		this.pos++;
		let out = '';
		for (;;) {
			if (this.pos >= this.src.length) fail('malformed', 'unterminated string');
			const c = this.src[this.pos];
			const code = c.charCodeAt(0);
			if (c === '"') {
				this.pos++;
				break;
			}
			if (code < 0x20) fail('malformed', 'raw control character');
			if (c !== '\\') {
				out += c;
				this.pos++;
				continue;
			}
			const e = this.src[this.pos + 1];
			this.pos += 2;
			const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
			if (e in simple) {
				out += simple[e];
				continue;
			}
			if (e !== 'u') fail('malformed', 'bad escape');
			const hex = this.src.slice(this.pos, this.pos + 4);
			if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('malformed', 'bad unicode escape');
			out += String.fromCharCode(parseInt(hex, 16));
			this.pos += 4;
		}
		if (!wellFormed(out)) fail('malformed', 'invalid unicode');
		return out;
	}

	array(depth: number): Json[] {
		this.pos++;
		const out: Json[] = [];
		this.space();
		if (this.src[this.pos] === ']') {
			this.pos++;
			return out;
		}
		for (;;) {
			this.space();
			out.push(this.value(depth + 1));
			this.space();
			const c = this.src[this.pos++];
			if (c === ']') return out;
			if (c !== ',') fail('malformed', 'bad array');
		}
	}

	object(depth: number): { [key: string]: Json } {
		this.pos++;
		const out: { [key: string]: Json } = Object.create(null);
		const seen = new Set<string>();
		this.space();
		if (this.src[this.pos] === '}') {
			this.pos++;
			return out;
		}
		for (;;) {
			this.space();
			if (this.src[this.pos] !== '"') fail('malformed', 'expected object key');
			const key = this.string();
			if (seen.has(key)) fail('malformed', 'duplicate key');
			seen.add(key);
			this.space();
			if (this.src[this.pos++] !== ':') fail('malformed', 'expected colon');
			this.space();
			out[key] = this.value(depth + 1);
			this.space();
			const c = this.src[this.pos++];
			if (c === '}') return out;
			if (c !== ',') fail('malformed', 'bad object');
		}
	}
}

export function parseJson(text: string): Json {
	const p = new Parser(text);
	p.space();
	if (p.pos >= text.length) fail('malformed', 'empty');
	const v = p.value(0);
	p.space();
	if (p.pos !== text.length) fail('malformed', 'trailing data');
	return v;
}

function wellFormed(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			const d = s.charCodeAt(i + 1);
			if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
			i++;
		} else if (c >= 0xdc00 && c <= 0xdfff) {
			return false;
		}
	}
	return true;
}

function compareUtf16(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function canonicalize(v: Json): string {
	if (v === null || typeof v === 'boolean') return JSON.stringify(v);
	if (typeof v === 'number') {
		if (!Number.isSafeInteger(v)) fail('malformed', 'number is not a safe integer');
		return String(v);
	}
	if (typeof v === 'string') {
		if (!wellFormed(v)) fail('malformed', 'invalid unicode');
		return JSON.stringify(v);
	}
	if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
	const keys = Object.keys(v).sort(compareUtf16);
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(',')}}`;
}

export function encodeCanonical(v: Json): Uint8Array {
	return utf8(canonicalize(v));
}

export function decodeCanonical(raw: Uint8Array, maxBytes: number): { [key: string]: Json } {
	if (raw.length > maxBytes) fail('too-large');
	let text: string;
	try {
		text = decoder.decode(raw);
	} catch {
		fail('malformed', 'invalid utf-8');
	}
	const v = parseJson(text);
	if (canonicalize(v) !== text) fail('malformed', 'not canonical JSON');
	if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('malformed', 'not an object');
	return v;
}
