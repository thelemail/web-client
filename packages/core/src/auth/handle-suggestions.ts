export function handleSuggestions(handle: string): string[] {
	const base = handle.replace(/[._-]+$/, '');
	if (!base) return [];
	const out: string[] = [];
	for (const c of [`${base}.mail`, `${base}mail`, `${base}.post`]) {
		if (c !== handle && !out.includes(c)) out.push(c);
	}
	return out;
}
