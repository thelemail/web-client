export type PersistenceState = 'persisted' | 'best-effort' | 'unsupported';

const KEY = 'thelemail.auth.persistence';

export interface PersistenceRecord {
	state: PersistenceState;
	at: number;
}

export function recordedPersistence(): PersistenceRecord | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PersistenceRecord;
		return parsed && typeof parsed.state === 'string' ? parsed : null;
	} catch {
		return null;
	}
}

export async function requestPersistence(): Promise<PersistenceState> {
	let state: PersistenceState = 'unsupported';
	try {
		if (navigator.storage?.persisted && (await navigator.storage.persisted())) {
			state = 'persisted';
		} else if (navigator.storage?.persist) {
			state = (await navigator.storage.persist()) ? 'persisted' : 'best-effort';
		}
	} catch {
		state = 'best-effort';
	}
	try {
		const record: PersistenceRecord = { state, at: Date.now() };
		localStorage.setItem(KEY, JSON.stringify(record));
	} catch {
		return state;
	}
	return state;
}
