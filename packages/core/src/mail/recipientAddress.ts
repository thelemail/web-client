export const MAX_LOCAL_PART_LENGTH = 64;
export const MAX_ADDRESS_LENGTH = 254;

const TAGGED_LOCAL_PART = /^([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)\+[a-z0-9!#$%&'*+/=?^_`{|}~.-]*$/;
const RECIPIENT_DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const EDGE_WHITESPACE = /^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g;
const NON_ASCII = /[^\x00-\x7f]/;

export function canonicalRecipient(address: string): string {
	const trimmed = address.replace(EDGE_WHITESPACE, '');
	if (NON_ASCII.test(trimmed)) return trimmed.toLowerCase();
	const s = trimmed.toLowerCase();
	if (s.length > MAX_ADDRESS_LENGTH) return s;
	const at = s.lastIndexOf('@');
	if (at <= 0 || at > MAX_LOCAL_PART_LENGTH) return s;
	const domain = s.slice(at + 1);
	if (!RECIPIENT_DOMAIN.test(domain)) return s;
	const m = TAGGED_LOCAL_PART.exec(s.slice(0, at));
	if (!m) return s;
	return `${m[1]}@${domain}`;
}

export function isOwnRecipient(address: string, mine: Iterable<string>): boolean {
	const own = new Set<string>();
	for (const e of mine) own.add(e.trim().toLowerCase());
	const plain = address.trim().toLowerCase();
	return own.has(plain) || own.has(canonicalRecipient(address));
}
