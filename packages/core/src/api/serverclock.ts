let offsetMs = 0;
let learned = false;

export function recordServerDate(header: string | null): void {
	if (!header) return;
	const serverMs = Date.parse(header);
	if (!Number.isFinite(serverMs)) return;
	offsetMs = serverMs - Date.now();
	learned = true;
}

export function serverClockOffsetMs(): number {
	return offsetMs;
}

export function serverClockLearned(): boolean {
	return learned;
}

export function serverNow(): number {
	return Date.now() + offsetMs;
}

export function resetServerClock(): void {
	offsetMs = 0;
	learned = false;
}
