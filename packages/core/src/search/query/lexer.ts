import { fail, LIMITS, type Range } from './ast';

export type Token =
	| { type: 'lparen' | 'rparen' | 'lbrace' | 'rbrace'; range: Range; spaced: boolean }
	| { type: 'minus' | 'plus'; range: Range; spaced: boolean }
	| { type: 'or' | 'and' | 'around'; range: Range; spaced: boolean }
	| { type: 'quoted'; value: string; range: Range; spaced: boolean }
	| { type: 'word'; raw: string; range: Range; spaced: boolean };

const KEYWORDS: Record<string, 'or' | 'and' | 'around'> = {
	OR: 'or',
	AND: 'and',
	AROUND: 'around'
};

const BRACKETS: Record<string, 'lparen' | 'rparen' | 'lbrace' | 'rbrace'> = {
	'(': 'lparen',
	')': 'rparen',
	'{': 'lbrace',
	'}': 'rbrace'
};

const SPACE = /\s/u;

function isSpace(ch: string | undefined): boolean {
	return ch !== undefined && SPACE.test(ch);
}

function endsWord(ch: string | undefined): boolean {
	return ch === undefined || isSpace(ch) || ch === '"' || ch in BRACKETS;
}

export function asciiLower(value: string): string {
	return value.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function asciiUpper(value: string): string {
	return value.replace(/[a-z]/g, (c) => c.toUpperCase());
}

export function byteLength(input: string): number {
	return new TextEncoder().encode(input).length;
}

export function tokenize(input: string): Token[] {
	if (byteLength(input) > LIMITS.bytes) {
		let end = 0;
		let bytes = 0;
		for (const ch of input) {
			bytes += byteLength(ch);
			if (bytes > LIMITS.bytes) break;
			end += ch.length;
		}
		fail('too_long', { start: end, end: input.length });
	}
	const tokens: Token[] = [];
	let i = 0;
	let spaced = true;
	while (i < input.length) {
		const ch = input[i];
		if (isSpace(ch)) {
			spaced = true;
			i += 1;
			continue;
		}
		const atomStart = spaced || (tokens.length > 0 && ['lparen', 'lbrace'].includes(tokens[tokens.length - 1].type));
		if (ch in BRACKETS) {
			tokens.push({ type: BRACKETS[ch], range: { start: i, end: i + 1 }, spaced });
			i += 1;
		} else if ((ch === '-' || ch === '+') && atomStart) {
			const next = input[i + 1];
			if (next === undefined || isSpace(next) || next === ')' || next === '}') {
				fail('dangling_operator', { start: i, end: i + 1 });
			}
			tokens.push({ type: ch === '-' ? 'minus' : 'plus', range: { start: i, end: i + 1 }, spaced });
			i += 1;
		} else if (ch === '"') {
			const start = i;
			let value = '';
			i += 1;
			let closed = false;
			while (i < input.length) {
				const c = input[i];
				if (c === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
					value += input[i + 1];
					i += 2;
					continue;
				}
				if (c === '"') {
					closed = true;
					i += 1;
					break;
				}
				value += c;
				i += 1;
			}
			if (!closed) fail('unterminated_quote', { start, end: input.length });
			tokens.push({ type: 'quoted', value, range: { start, end: i }, spaced });
		} else {
			const start = i;
			while (!endsWord(input[i])) i += 1;
			const raw = input.slice(start, i);
			const keyword = Object.hasOwn(KEYWORDS, asciiUpper(raw)) ? KEYWORDS[asciiUpper(raw)] : undefined;
			const range = { start, end: i };
			tokens.push(keyword ? { type: keyword, range, spaced } : { type: 'word', raw, range, spaced });
		}
		spaced = false;
	}
	return tokens;
}
