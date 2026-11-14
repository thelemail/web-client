const MIB = 1024 * 1024;
const SQLITE_FULL = 13;

export const RESERVE_CAP = 256 * MIB;

export type Admission = { ok: true } | { ok: false; reason: 'quota' };

export interface StorageLike {
	estimate?: () => Promise<{ quota?: number; usage?: number }>;
	persist?: () => Promise<boolean>;
	persisted?: () => Promise<boolean>;
}

function storage(): StorageLike | undefined {
	return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

export function reserveFor(quota: number): number {
	return Math.min(RESERVE_CAP, Math.floor(quota / 10));
}

export async function requestPersistence(store: StorageLike | undefined = storage()): Promise<boolean> {
	try {
		if (await store?.persisted?.()) return true;
		return (await store?.persist?.()) ?? false;
	} catch {
		return false;
	}
}

export async function admit(bytes: number, store: StorageLike | undefined = storage()): Promise<Admission> {
	let estimate: { quota?: number; usage?: number } | undefined;
	try {
		estimate = await store?.estimate?.();
	} catch {
		return { ok: true };
	}
	if (!estimate || typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') return { ok: true };
	const free = estimate.quota - estimate.usage;
	return free - bytes >= reserveFor(estimate.quota) ? { ok: true } : { ok: false, reason: 'quota' };
}

export function isQuotaError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const e = error as { name?: unknown; resultCode?: unknown; message?: unknown };
	if (e.name === 'QuotaExceededError') return true;
	if (typeof e.resultCode === 'number' && (e.resultCode & 0xff) === SQLITE_FULL) return true;
	return typeof e.message === 'string' && /SQLITE_FULL|QuotaExceededError|database or disk is full/.test(e.message);
}
