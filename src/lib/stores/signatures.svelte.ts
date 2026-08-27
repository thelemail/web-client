import { browser } from '$app/environment';
import {
	listSignatures,
	upsertSignature,
	deleteSignature,
	getSignatureImageDownloadUrl,
	type Signature,
	type UpsertSignatureInput
} from '$lib/api/signatures';

interface CachedImage {
	blob: Blob;
	contentType: string;
}

class SignaturesStore {
	items = $state<Signature[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;

	#imageCache = new Map<string, CachedImage>();

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
	}

	async load(): Promise<void> {
		if (!browser) return;
		const acct = this.#accountId;
		this.loading = true;
		this.error = null;
		try {
			const { signatures } = await listSignatures();
			if (this.#accountId !== acct) return;
			this.items = signatures;
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : 'failed to load signatures';
			this.items = [];
		} finally {
			if (this.#accountId === acct) this.loading = false;
		}
	}

	getForAddress(addressId: string | null): Signature | null {
		if (!addressId) return null;
		return this.items.find((s) => s.addressId === addressId) ?? null;
	}

	async save(addressId: string, input: UpsertSignatureInput): Promise<Signature> {
		const updated = await upsertSignature(addressId, input);
		const idx = this.items.findIndex((s) => s.addressId === addressId);
		if (idx >= 0) {
			this.items = this.items.map((s, i) => (i === idx ? updated : s));
		} else {
			this.items = [...this.items, updated];
		}
		return updated;
	}

	async remove(addressId: string): Promise<void> {
		await deleteSignature(addressId);
		this.items = this.items.filter((s) => s.addressId !== addressId);
	}

	clear(): void {
		this.items = [];
		this.error = null;
		this.#imageCache.clear();
	}

	cacheImage(objectKey: string, blob: Blob, contentType: string): void {
		this.#imageCache.set(objectKey, { blob, contentType });
	}

	async fetchImage(objectKey: string): Promise<CachedImage> {
		const cached = this.#imageCache.get(objectKey);
		if (cached) return cached;
		const grant = await getSignatureImageDownloadUrl(objectKey);
		const resp = await fetch(grant.downloadUrl);
		if (!resp.ok) {
			throw new Error(`failed to fetch signature image: HTTP ${resp.status}`);
		}
		const contentType = resp.headers.get('content-type') ?? 'application/octet-stream';
		const blob = await resp.blob();
		const value: CachedImage = { blob, contentType };
		this.#imageCache.set(objectKey, value);
		return value;
	}
}

export const signatures = new SignaturesStore();
