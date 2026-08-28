import { browser } from '$app/environment';

const KEY = 'thelemail.device';

let memoryId: string | null = null;

function generate(): string {
	return crypto.randomUUID();
}

export function deviceId(): string {
	if (!browser) return memoryId ?? (memoryId = generate());
	try {
		let id = sessionStorage.getItem(KEY);
		if (!id) {
			id = generate();
			sessionStorage.setItem(KEY, id);
		}
		return id;
	} catch {
		return memoryId ?? (memoryId = generate());
	}
}
