const OPEN_TIMEOUT_MS = 15_000;

export function openDatabase(
	name: string,
	version: number,
	upgrade: (db: IDBDatabase) => void
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error(`indexeddb unavailable for ${name}`));
			return;
		}
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (act: () => void) => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			act();
		};
		const req = indexedDB.open(name, version);
		timer = setTimeout(
			() => finish(() => reject(new Error(`indexeddb ${name} did not open in time`))),
			OPEN_TIMEOUT_MS
		);
		req.onupgradeneeded = () => upgrade(req.result);
		req.onblocked = () =>
			finish(() => reject(new Error(`indexeddb ${name} upgrade blocked by another tab`)));
		req.onsuccess = () => finish(() => resolve(req.result));
		req.onerror = () =>
			finish(() => reject(req.error ?? new Error(`indexeddb ${name} failed to open`)));
	});
}
