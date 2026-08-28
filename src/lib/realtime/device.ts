import { browser } from '$app/environment';

const KEY = 'thelemail.device';

let memoryId: string | null = null;
const localIds = new Set<string>();

function generate(): string {
	return crypto.randomUUID();
}

export function deviceId(): string {
	let id: string;
	if (!browser) {
		id = memoryId ?? (memoryId = generate());
	} else {
		try {
			id = sessionStorage.getItem(KEY) ?? '';
			if (!id) {
				id = generate();
				sessionStorage.setItem(KEY, id);
			}
		} catch {
			id = memoryId ?? (memoryId = generate());
		}
	}
	localIds.add(id);
	return id;
}

export function localDeviceIds(): ReadonlySet<string> {
	return localIds;
}

export function noteLocalDevice(id: string): void {
	if (id) localIds.add(id);
}

export function forgetLocalDevice(id: string): void {
	localIds.delete(id);
}
