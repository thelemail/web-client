export const BUSY_CANON_VERSION = 1;

export interface BusyWindowInstants {
	startsAt: string;
	endsAt: string;
}

export interface BusyStatement {
	calendarId: string;
	itemId: string;
	privacy: string;
	rev: number;
	signerAccountId: string;
	windows: BusyWindowInstants[];
}

function windowPairs(windows: BusyWindowInstants[]): [number, number][] {
	const pairs = windows.map((w): [number, number] => [
		Date.parse(w.startsAt),
		Date.parse(w.endsAt)
	]);
	for (const [start, end] of pairs) {
		if (!Number.isFinite(start) || !Number.isFinite(end)) {
			throw new Error('busy window is not a valid instant');
		}
	}
	return pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function canonicalise(statement: BusyStatement): Uint8Array {
	const wire = {
		calendarId: statement.calendarId.toLowerCase(),
		itemId: statement.itemId.toLowerCase(),
		privacy: statement.privacy,
		rev: statement.rev,
		signerAccountId: statement.signerAccountId.toLowerCase(),
		version: BUSY_CANON_VERSION,
		windows: windowPairs(statement.windows)
	};
	return new TextEncoder().encode(JSON.stringify(wire));
}
