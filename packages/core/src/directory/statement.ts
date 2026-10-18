export const MAX_STATEMENT_BYTES = 8192;
export const MAX_KEY_TRANSITIONS = 16;

const MAX_VERSION = 2n ** 53n - 1n;

export type StatementErrorKind =
	| 'too_large'
	| 'bom'
	| 'invalid_utf8'
	| 'syntax'
	| 'trailing_data'
	| 'duplicate_key'
	| 'invalid_field';

export class StatementParseError extends Error {
	kind: StatementErrorKind;
	field?: string;
	constructor(kind: StatementErrorKind, message: string, field?: string) {
		super(message);
		this.kind = kind;
		this.field = field;
		this.name = 'StatementParseError';
	}
}

export interface StatementKeyTransition {
	previousKeyFingerprint: string;
	retiredAt: string;
	retiredAtMillis: number;
	signature: Uint8Array;
}

export interface DirectoryStatement {
	accountId: string;
	address: string;
	issuedAt: string;
	keyAlgorithm: string;
	keyFingerprint: string;
	keyTransitions: StatementKeyTransition[];
	signingKeyFingerprint: string;
	version: number;
}

type JsonValue =
	| { kind: 'string'; text: string }
	| { kind: 'number'; text: string; integer: boolean }
	| { kind: 'bool' }
	| { kind: 'null' }
	| { kind: 'object'; members: Map<string, JsonValue> }
	| { kind: 'array'; items: JsonValue[] };

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function parseStatementBytes(raw: Uint8Array): DirectoryStatement {
	if (raw.length > MAX_STATEMENT_BYTES) {
		throw new StatementParseError('too_large', `statement is ${raw.length} bytes`);
	}
	if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
		throw new StatementParseError('bom', 'statement starts with a byte order mark');
	}
	let text: string;
	try {
		text = utf8.decode(raw);
	} catch {
		throw new StatementParseError('invalid_utf8', 'statement is not valid UTF-8');
	}
	if (text.length === 0 || text[0] !== '{') {
		throw new StatementParseError('syntax', 'expected an object at offset 0');
	}
	const scanner = new Scanner(text);
	const root = scanner.value();
	if (scanner.pos !== text.length) {
		throw new StatementParseError('trailing_data', `data after the object at offset ${scanner.pos}`);
	}
	return statementFromObject(root);
}

function statementFromObject(root: JsonValue): DirectoryStatement {
	if (root.kind !== 'object') throw new StatementParseError('syntax', 'expected an object');
	const accountId = stringMember(root.members, 'accountId');
	const address = stringMember(root.members, 'address');
	const keyAlgorithm = stringMember(root.members, 'keyAlgorithm');
	const keyFingerprint = fingerprintMember(root.members, 'keyFingerprint');
	const signingKeyFingerprint = fingerprintMember(root.members, 'signingKeyFingerprint');
	const issuedAt = timestampMember(root.members, 'issuedAt').text;
	const version = versionMember(root.members);
	const keyTransitions = transitionsMember(root.members);
	return {
		accountId,
		address,
		issuedAt,
		keyAlgorithm,
		keyFingerprint,
		keyTransitions,
		signingKeyFingerprint,
		version
	};
}

function fieldError(field: string, problem: string): StatementParseError {
	return new StatementParseError('invalid_field', `${field} ${problem}`, field);
}

function stringMember(members: Map<string, JsonValue>, name: string, path = name): string {
	const v = members.get(name);
	if (!v) throw fieldError(path, 'is missing');
	if (v.kind !== 'string') throw fieldError(path, 'is not a string');
	return v.text;
}

function fingerprintMember(members: Map<string, JsonValue>, name: string, path = name): string {
	const s = stringMember(members, name, path);
	if (!isFingerprintHex(s)) throw fieldError(path, 'is not lowercase hex of 40 or 64 characters');
	return s;
}

function timestampMember(
	members: Map<string, JsonValue>,
	name: string,
	path = name
): { text: string; millis: number } {
	const s = stringMember(members, name, path);
	const millis = parseTimestamp(s);
	if (millis === null) throw fieldError(path, 'is not an RFC 3339 UTC time in whole seconds');
	return { text: s, millis };
}

function versionMember(members: Map<string, JsonValue>): number {
	const v = members.get('version');
	if (!v) throw fieldError('version', 'is missing');
	if (v.kind !== 'number' || !v.integer) throw fieldError('version', 'is not an integer');
	const n = BigInt(v.text);
	if (n < 1n || n > MAX_VERSION) throw fieldError('version', 'is out of range');
	return Number(n);
}

function transitionsMember(members: Map<string, JsonValue>): StatementKeyTransition[] {
	const v = members.get('keyTransitions');
	if (!v) return [];
	if (v.kind !== 'array') throw fieldError('keyTransitions', 'is not an array');
	if (v.items.length < 1 || v.items.length > MAX_KEY_TRANSITIONS) {
		throw fieldError('keyTransitions', `must hold 1 to ${MAX_KEY_TRANSITIONS} elements`);
	}
	return v.items.map((item, i) => {
		const prefix = `keyTransitions[${i}]`;
		if (item.kind !== 'object') throw fieldError(prefix, 'is not an object');
		const previousKeyFingerprint = fingerprintMember(
			item.members,
			'previousKeyFingerprint',
			`${prefix}.previousKeyFingerprint`
		);
		const retiredAt = timestampMember(item.members, 'retiredAt', `${prefix}.retiredAt`);
		const signatureText = stringMember(item.members, 'signature', `${prefix}.signature`);
		const signature = decodeStrictBase64(signatureText);
		if (!signature) throw fieldError(`${prefix}.signature`, 'is not standard base64');
		return {
			previousKeyFingerprint,
			retiredAt: retiredAt.text,
			retiredAtMillis: retiredAt.millis,
			signature
		};
	});
}

export function isFingerprintHex(s: string): boolean {
	return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s);
}

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

export function parseTimestamp(s: string): number | null {
	const m = TIMESTAMP.exec(s);
	if (!m) return null;
	const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > daysInMonth(year, month)) return null;
	if (hour > 23 || minute > 59 || second > 59) return null;
	const d = new Date(0);
	d.setUTCFullYear(year, month - 1, day);
	d.setUTCHours(hour, minute, second, 0);
	return d.getTime();
}

function daysInMonth(year: number, month: number): number {
	if (month === 2) {
		const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
		return leap ? 29 : 28;
	}
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const BASE64 = /^[A-Za-z0-9+/=]+$/;

export function decodeStrictBase64(s: string): Uint8Array | null {
	if (s.length === 0 || s.length % 4 !== 0 || !BASE64.test(s)) return null;
	let bin: string;
	try {
		bin = atob(s);
	} catch {
		return null;
	}
	if (bin.length === 0 || btoa(bin) !== s) return null;
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

class Scanner {
	pos = 0;
	constructor(private readonly s: string) {}

	private syntax(what: string): StatementParseError {
		return new StatementParseError('syntax', `${what} at offset ${this.pos}`);
	}

	private skipSpace(): void {
		while (this.pos < this.s.length) {
			const c = this.s[this.pos];
			if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') return;
			this.pos++;
		}
	}

	value(): JsonValue {
		if (this.pos >= this.s.length) throw this.syntax('unexpected end');
		const c = this.s[this.pos];
		if (c === '{') return this.object();
		if (c === '[') return this.array();
		if (c === '"') return { kind: 'string', text: this.str() };
		if (c === '-' || (c >= '0' && c <= '9')) return this.number();
		if (c === 't') return this.literal('true', { kind: 'bool' });
		if (c === 'f') return this.literal('false', { kind: 'bool' });
		if (c === 'n') return this.literal('null', { kind: 'null' });
		throw this.syntax('unexpected character');
	}

	private object(): JsonValue {
		this.pos++;
		const members = new Map<string, JsonValue>();
		this.skipSpace();
		if (this.s[this.pos] === '}') {
			this.pos++;
			return { kind: 'object', members };
		}
		for (;;) {
			this.skipSpace();
			if (this.s[this.pos] !== '"') throw this.syntax('expected a key');
			const keyAt = this.pos;
			const key = this.str();
			if (members.has(key)) {
				throw new StatementParseError(
					'duplicate_key',
					`${JSON.stringify(key)} at offset ${keyAt} appears twice`
				);
			}
			this.skipSpace();
			if (this.s[this.pos] !== ':') throw this.syntax('expected a colon');
			this.pos++;
			this.skipSpace();
			members.set(key, this.value());
			this.skipSpace();
			if (this.pos >= this.s.length) throw this.syntax('unterminated object');
			const c = this.s[this.pos];
			if (c === ',') {
				this.pos++;
			} else if (c === '}') {
				this.pos++;
				return { kind: 'object', members };
			} else {
				throw this.syntax('expected a comma or closing brace');
			}
		}
	}

	private array(): JsonValue {
		this.pos++;
		const items: JsonValue[] = [];
		this.skipSpace();
		if (this.s[this.pos] === ']') {
			this.pos++;
			return { kind: 'array', items };
		}
		for (;;) {
			this.skipSpace();
			items.push(this.value());
			this.skipSpace();
			if (this.pos >= this.s.length) throw this.syntax('unterminated array');
			const c = this.s[this.pos];
			if (c === ',') {
				this.pos++;
			} else if (c === ']') {
				this.pos++;
				return { kind: 'array', items };
			} else {
				throw this.syntax('expected a comma or closing bracket');
			}
		}
	}

	private literal(word: string, v: JsonValue): JsonValue {
		if (this.s.slice(this.pos, this.pos + word.length) !== word) throw this.syntax('invalid literal');
		this.pos += word.length;
		return v;
	}

	private digits(): number {
		let n = 0;
		while (this.pos < this.s.length && this.s[this.pos] >= '0' && this.s[this.pos] <= '9') {
			this.pos++;
			n++;
		}
		return n;
	}

	private number(): JsonValue {
		const start = this.pos;
		let integer = true;
		if (this.s[this.pos] === '-') this.pos++;
		if (this.pos >= this.s.length) throw this.syntax('invalid number');
		const c = this.s[this.pos];
		if (c === '0') {
			this.pos++;
		} else if (c >= '1' && c <= '9') {
			this.digits();
		} else {
			throw this.syntax('invalid number');
		}
		if (this.s[this.pos] === '.') {
			integer = false;
			this.pos++;
			if (this.digits() === 0) throw this.syntax('invalid fraction');
		}
		if (this.s[this.pos] === 'e' || this.s[this.pos] === 'E') {
			integer = false;
			this.pos++;
			if (this.s[this.pos] === '+' || this.s[this.pos] === '-') this.pos++;
			if (this.digits() === 0) throw this.syntax('invalid exponent');
		}
		return { kind: 'number', text: this.s.slice(start, this.pos), integer };
	}

	private str(): string {
		this.pos++;
		let out = '';
		for (;;) {
			if (this.pos >= this.s.length) throw this.syntax('unterminated string');
			const c = this.s[this.pos];
			if (c === '"') {
				this.pos++;
				return out;
			}
			if (c.charCodeAt(0) < 0x20) throw this.syntax('control character in string');
			if (c === '\\') {
				out += this.escape();
				continue;
			}
			out += c;
			this.pos++;
		}
	}

	private escape(): string {
		this.pos++;
		if (this.pos >= this.s.length) throw this.syntax('unterminated escape');
		const c = this.s[this.pos];
		this.pos++;
		switch (c) {
			case '"':
				return '"';
			case '\\':
				return '\\';
			case '/':
				return '/';
			case 'b':
				return '\b';
			case 'f':
				return '\f';
			case 'n':
				return '\n';
			case 'r':
				return '\r';
			case 't':
				return '\t';
			case 'u':
				break;
			default:
				throw this.syntax('invalid escape');
		}
		const unit = this.hex4();
		if (unit === null) throw this.syntax('invalid unicode escape');
		if (unit >= 0xd800 && unit <= 0xdbff) {
			if (this.s[this.pos] !== '\\' || this.s[this.pos + 1] !== 'u') {
				throw this.syntax('unpaired surrogate');
			}
			this.pos += 2;
			const low = this.hex4();
			if (low === null || low < 0xdc00 || low > 0xdfff) throw this.syntax('unpaired surrogate');
			return String.fromCharCode(unit, low);
		}
		if (unit >= 0xdc00 && unit <= 0xdfff) throw this.syntax('unpaired surrogate');
		return String.fromCharCode(unit);
	}

	private hex4(): number | null {
		const h = this.s.slice(this.pos, this.pos + 4);
		if (!/^[0-9a-fA-F]{4}$/.test(h)) return null;
		this.pos += 4;
		return parseInt(h, 16);
	}
}
