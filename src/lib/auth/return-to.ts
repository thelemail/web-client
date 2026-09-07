const SLOT_PREFIX = /^\/u\/\d+(?=\/)/;
const ALLOWED = [/^\/u\/\d+(\/|$)/, /^\/invite\/[^/]+$/];

export function resolveReturnTo(raw: string | null, slot: number): string {
	const inbox = `/u/${slot}/mail/inbox`;
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
		return inbox;
	}
	const path = raw.split('?')[0].split('#')[0];
	if (!ALLOWED.some((re) => re.test(path))) return inbox;
	if (/^\/u\/\d+$/.test(path)) return inbox;
	return raw.replace(SLOT_PREFIX, `/u/${slot}`);
}
