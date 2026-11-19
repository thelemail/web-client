import { b64encode } from '$core/keystore/productkeys/encoding';

const KEY = 'thelemail-tab-seal';

export function tabHalf(): string | null {
	try {
		return sessionStorage.getItem(KEY);
	} catch {
		return null;
	}
}

export function ensureTabHalf(): string | null {
	const existing = tabHalf();
	if (existing) return existing;
	const fresh = b64encode(crypto.getRandomValues(new Uint8Array(32)));
	try {
		sessionStorage.setItem(KEY, fresh);
		return fresh;
	} catch {
		return null;
	}
}
