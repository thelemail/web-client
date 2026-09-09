export function initialsFor(fullName: string | null, email: string | null): string {
	const name = (fullName ?? '').trim();
	if (name) {
		const parts = name.split(/\s+/);
		if (parts.length === 1) {
			return parts[0].slice(0, 2).toUpperCase();
		}
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}
	const local = (email ?? '').split('@')[0];
	return (local.slice(0, 2) || 'th').toUpperCase();
}
