const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const NUMERIC_TLD = /\.\d+$/;

export function domainFromInput(raw: string): string {
	const bare = raw
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '')
		.replace(/\.$/, '');
	if (!bare || /[@:?#\s[\]]/.test(bare)) return '';
	let ascii: string;
	try {
		ascii = new URL(`http://${bare}`).hostname;
	} catch {
		return '';
	}
	return DOMAIN_RE.test(ascii) && !NUMERIC_TLD.test(ascii) ? ascii : '';
}
