export interface ParsedMailbox {
	name: string;
	address: string;
}

const MAX_DISPLAY_LENGTH = 255;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

function stripControls(value: string): string {
	return value.replace(/\t/g, ' ').replace(CONTROL_RE, '');
}

export function sanitizeDisplayName(value: string): string {
	const cleaned = stripControls(value).trim();
	return cleaned.length > MAX_DISPLAY_LENGTH ? cleaned.slice(0, MAX_DISPLAY_LENGTH).trim() : cleaned;
}

function unfold(input: string): string {
	return input.replace(/\r\n?/g, '\n').replace(/\n[ \t]+/g, ' ');
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
	const inner = trimmed.slice(1, -1);
	let out = '';
	for (let i = 0; i < inner.length; i++) {
		if (inner[i] === '\\' && i + 1 < inner.length) {
			out += inner[++i];
			continue;
		}
		out += inner[i];
	}
	return out.trim();
}

export function splitAddressList(input: string): string[] {
	const source = unfold(input);
	const parts: string[] = [];
	let current = '';
	let quoted = false;
	let angled = false;
	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		if (quoted) {
			if (ch === '\\' && i + 1 < source.length) {
				current += ch + source[++i];
				continue;
			}
			if (ch === '"') quoted = false;
			current += ch;
			continue;
		}
		if (ch === '"') {
			quoted = true;
		} else if (ch === '<') {
			angled = true;
		} else if (ch === '>') {
			angled = false;
		} else if (!angled && (ch === ',' || ch === ';' || ch === '\n')) {
			parts.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

export function insideMailbox(value: string): boolean {
	let quoted = false;
	let angled = false;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (quoted) {
			if (ch === '\\') i++;
			else if (ch === '"') quoted = false;
			continue;
		}
		if (ch === '"') quoted = true;
		else if (ch === '<') angled = true;
		else if (ch === '>') angled = false;
	}
	return quoted || angled;
}

export function parseMailbox(input: string): ParsedMailbox {
	const raw = unfold(input).trim();
	const open = raw.lastIndexOf('<');
	if (open !== -1 && raw.endsWith('>')) {
		const address = raw.slice(open + 1, -1).trim();
		if (!address.includes('<') && !address.includes('>')) {
			return { name: sanitizeDisplayName(unquote(raw.slice(0, open))), address: stripControls(address) };
		}
	}
	return { name: '', address: sanitizeDisplayName(raw) };
}

export function parseAddressList(input: string): ParsedMailbox[] {
	return splitAddressList(input).map(parseMailbox);
}
