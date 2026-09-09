function originsOf(value: string | undefined): string[] {
	if (!value) return [];
	const out: string[] = [];
	for (const item of value.split(/\s+/).filter(Boolean)) {
		try {
			out.push(new URL(item).origin);
		} catch {
			continue;
		}
	}
	return out;
}

const allowed = new Set([
	...originsOf(import.meta.env.PUBLIC_API_BASE_URL),
	...originsOf(import.meta.env.PUBLIC_BLOB_ORIGIN)
]);

export function isAllowedBlobUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
	return allowed.has(parsed.origin);
}
