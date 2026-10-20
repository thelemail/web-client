export function userIdEmail(userId: string): string | null {
	const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(userId);
	if (bracketed) return bracketed[1].toLowerCase();
	const bare = userId.trim();
	return /^[^\s@]+@[^\s@]+$/.test(bare) ? bare.toLowerCase() : null;
}

export function userIdsMatch(userIds: string[], address: string): boolean {
	const want = address.trim().toLowerCase();
	return userIds.some((u) => userIdEmail(u) === want);
}
