const EXEMPT = ['recovery', 'billing', 'lifecycle', 'deletion-pending'];

export function recoveryPath(slot: number): string {
	return `/u/${slot}/recovery`;
}

function isUnder(pathname: string, base: string): boolean {
	return pathname === base || pathname.startsWith(`${base}/`);
}

export function recoveryGateTarget(
	pathname: string,
	search: string,
	slot: number,
	recoveryEnabled: boolean | null
): string | null {
	const base = `/u/${slot}`;
	if (recoveryEnabled === true && isUnder(pathname, recoveryPath(slot))) {
		return `${base}/mail/inbox`;
	}
	if (recoveryEnabled !== false) return null;
	if (EXEMPT.some((seg) => isUnder(pathname, `${base}/${seg}`))) return null;
	const back = pathname === base || pathname === `${base}/` ? '' : pathname + search;
	const query = back ? `?redirect=${encodeURIComponent(back)}` : '';
	return `${recoveryPath(slot)}${query}`;
}
