export const ANALYZER_VERSION = 2;
export const MAX_LITERAL = 4096;

const EMAIL = /[\p{L}\p{N}._%+'=-]+@(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]{2,}/gu;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/giu;
const DOMAIN = /(?<![\p{L}\p{N}@.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}[\p{L}\p{N}-]*[\p{L}\p{N}](?![\p{L}\p{N}-])/gu;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const REFERENCE = /(?<![\p{L}\p{N}])[\p{L}\p{N}]*\p{N}[\p{L}\p{N}]*(?:[-/_.#:][\p{L}\p{N}]+)+|(?<![\p{L}\p{N}])[\p{L}\p{N}]+(?:[-/_.#:][\p{L}\p{N}]+)*[-/_.#:][\p{L}\p{N}]*\p{N}[\p{L}\p{N}]*/gu;
const SCRIPTS = ['Han', 'Hiragana', 'Katakana', 'Hangul', 'Thai', 'Lao', 'Khmer', 'Myanmar', 'Tibetan'];
const SCRIPT_CHAR = `(?:(?!\\p{P})[${SCRIPTS.map((s) => `\\p{scx=${s}}`).join('')}])`;
const UNSEGMENTED = new RegExp(`${SCRIPT_CHAR}+`, 'gu');
const HAS_UNSEGMENTED = new RegExp(SCRIPT_CHAR, 'u');

export function hasUnsegmented(text: string): boolean {
	return HAS_UNSEGMENTED.test(text);
}

export function normalize(text: string): string {
	return text.normalize('NFKC');
}

export function asciiDomain(domain: string): string | null {
	try {
		const host = new URL(`http://${domain}`).hostname;
		return host === domain.toLowerCase() ? null : host;
	} catch {
		return null;
	}
}

export function listKey(value: string): string {
	const trimmed = value.trim();
	const bare = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
	return normalize(bare).toLowerCase();
}

export function domainOf(address: string): string {
	const at = address.lastIndexOf('@');
	return at < 0 ? '' : address.slice(at + 1).toLowerCase();
}

function windows(text: string): string[] {
	if (text.length <= MAX_LITERAL) return [text];
	const out: string[] = [];
	for (let start = 0; start < text.length; start += MAX_LITERAL - 2) {
		out.push(text.slice(start, start + MAX_LITERAL));
		if (start + MAX_LITERAL >= text.length) break;
	}
	return out;
}

export function literals(text: string): string[] {
	const source = normalize(text);
	const found = new Set<string>();
	const add = (value: string) => {
		if (value.length < 3 && !HAS_UNSEGMENTED.test(value)) return;
		for (const w of windows(value)) found.add(w);
	};
	for (const re of [EMAIL, URL_RE, UUID, REFERENCE, UNSEGMENTED]) {
		for (const m of source.matchAll(re)) add(m[0]);
	}
	for (const m of source.matchAll(DOMAIN)) {
		add(m[0]);
		const ascii = asciiDomain(m[0]);
		if (ascii) add(ascii);
	}
	for (const m of source.matchAll(EMAIL)) {
		const at = m[0].lastIndexOf('@');
		const domain = m[0].slice(at + 1);
		add(domain);
		const ascii = asciiDomain(domain);
		if (ascii) {
			add(ascii);
			add(`${m[0].slice(0, at + 1)}${ascii}`);
		}
	}
	return [...found];
}

export function filenameLiterals(filename: string): string[] {
	const name = normalize(filename);
	const out = new Set<string>([name]);
	const dot = name.lastIndexOf('.');
	if (dot > 0 && dot < name.length - 1) out.add(name.slice(dot));
	for (const l of literals(name)) out.add(l);
	return [...out].filter((v) => v.length > 0);
}
