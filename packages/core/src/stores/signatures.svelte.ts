import { browser } from '$app/environment';
import { platform } from '$platform';
import {
	listSignatures,
	upsertSignature,
	deleteSignature,
	getSignatureImageDownloadUrl,
	type SignatureRecord
} from '$core/api/signatures';
import { aliasKeys } from './aliasKeys.svelte';
import { addresses } from './addresses.svelte';
import { keystore } from '$core/keystore/keystore-client';
import {
	openSignature,
	openSignatureImage,
	sealSignature,
	legacyDoc,
	type SealTarget,
	type SignatureDoc
} from '$core/mail/signatureCrypto';

interface CachedImage {
	blob: Blob;
	contentType: string;
}

export interface Signature {
	id: string;
	accountId: string;
	addressId: string;
	addressEmail: string;
	doc: SignatureDoc;
	bodyHtml: string;
	enabled: boolean;
	appendOnReply: boolean;
	sealed: boolean;
	legacy: boolean;
	updatedAt: string;
}

class SignaturesStore {
	items = $state<Signature[]>([]);
	loading = $state(false);
	loaded = $state(false);
	locked = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;
	#ready: Promise<void> | null = null;
	#watching = false;
	#backfilled = new Set<string>();

	#imageCache = new Map<string, CachedImage>();
	#objectUrls = new Map<string, string>();
	#imageAddress = new Map<string, string>();

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
		this.#watch();
	}

	#watch(): void {
		if (!browser || this.#watching) return;
		this.#watching = true;
		keystore.subscribe((b) => {
			if (b.type === 'locked' || b.type === 'cleared' || b.type === 'clearedAll') {
				this.locked = true;
				return;
			}
			if (b.type === 'vaultChanged' && b.accountId === this.#accountId) {
				void this.load();
			}
		});
	}

	ready(): Promise<void> {
		this.#ready ??= this.#fetch();
		return this.#ready;
	}

	load(): Promise<void> {
		this.#ready = this.#fetch();
		return this.#ready;
	}

	async #fetch(): Promise<void> {
		if (!browser) {
			this.loaded = true;
			return;
		}
		const acct = this.#accountId;
		if (!acct) {
			this.loaded = true;
			return;
		}
		this.loading = true;
		this.error = null;
		try {
			await aliasKeys.ready(acct);
			const { signatures } = await listSignatures();
			if (this.#accountId !== acct) return;
			const decoded: Signature[] = [];
			let anyLocked = false;
			for (const rec of signatures) {
				const opened = await openSignature(acct, rec);
				if (this.#accountId !== acct) return;
				if (!opened.ok) {
					if (opened.reason === 'locked') anyLocked = true;
					decoded.push(this.#sealedPlaceholder(rec));
					continue;
				}
				decoded.push(this.#decoded(rec, opened.doc, opened.legacy));
			}
			this.items = decoded;
			this.locked = anyLocked;
			void this.#backfillLegacy(acct);
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : 'failed to load signatures';
			this.items = [];
		} finally {
			if (this.#accountId === acct) {
				this.loading = false;
				this.loaded = true;
			}
		}
	}

	#decoded(rec: SignatureRecord, doc: SignatureDoc, legacy: boolean): Signature {
		for (const img of doc.images) this.#imageAddress.set(img.objectKey, rec.addressId);
		return {
			id: rec.id,
			accountId: rec.accountId,
			addressId: rec.addressId,
			addressEmail: addresses.getById(rec.addressId)?.email ?? '',
			doc,
			bodyHtml: doc.bodyHtml,
			enabled: rec.enabled,
			appendOnReply: rec.appendOnReply,
			sealed: false,
			legacy,
			updatedAt: rec.updatedAt
		};
	}

	#sealedPlaceholder(rec: SignatureRecord): Signature {
		return {
			id: rec.id,
			accountId: rec.accountId,
			addressId: rec.addressId,
			addressEmail: addresses.getById(rec.addressId)?.email ?? '',
			doc: legacyDoc(''),
			bodyHtml: '',
			enabled: rec.enabled,
			appendOnReply: rec.appendOnReply,
			sealed: true,
			legacy: false,
			updatedAt: rec.updatedAt
		};
	}

	targetFor(addressId: string): SealTarget | null {
		const acct = this.#accountId;
		if (!acct) return null;
		const addr = addresses.getById(addressId);
		return { accountId: acct, aliasId: addr?.sharedAliasId ?? undefined };
	}

	async #backfillLegacy(accountId: string): Promise<void> {
		if (this.locked) return;
		for (const sig of this.items) {
			if (!sig.legacy || this.#backfilled.has(sig.addressId)) continue;
			this.#backfilled.add(sig.addressId);
			try {
				await this.save(sig.addressId, sig.doc, {
					enabled: sig.enabled,
					appendOnReply: sig.appendOnReply
				});
			} catch {
				this.#backfilled.delete(sig.addressId);
			}
			if (this.#accountId !== accountId) return;
		}
	}

	getForAddress(addressId: string | null): Signature | null {
		if (!addressId) return null;
		return this.items.find((s) => s.addressId === addressId) ?? null;
	}

	bodyFor(addressId: string | null): string {
		return this.getForAddress(addressId)?.bodyHtml ?? '';
	}

	effectiveFor(addressId: string | null, kind: 'new' | 'reply'): string | null {
		const sig = this.getForAddress(addressId);
		if (!sig) return null;
		const body = sig.bodyHtml.trim();
		if (!body) return null;
		if (!sig.enabled) return null;
		if (kind === 'reply' && !sig.appendOnReply) return null;
		return sig.bodyHtml;
	}

	async save(
		addressId: string,
		doc: SignatureDoc,
		flags: { enabled: boolean; appendOnReply: boolean }
	): Promise<Signature> {
		if (this.locked) throw new Error('vault is locked');
		const target = this.targetFor(addressId);
		if (!target) throw new Error('no active account');
		const payload = await sealSignature(target, doc, flags);
		const updated = await upsertSignature(addressId, payload);
		const next = this.#decoded(updated, doc, false);
		const idx = this.items.findIndex((s) => s.addressId === addressId);
		if (idx >= 0) {
			this.items = this.items.map((s, i) => (i === idx ? next : s));
		} else {
			this.items = [...this.items, next];
		}
		return next;
	}

	async remove(addressId: string): Promise<void> {
		await deleteSignature(addressId);
		this.items = this.items.filter((s) => s.addressId !== addressId);
	}

	clear(): void {
		this.items = [];
		this.error = null;
		this.loaded = false;
		this.locked = false;
		this.#backfilled.clear();
		this.#ready = null;
		this.#imageCache.clear();
		this.#imageAddress.clear();
		for (const url of this.#objectUrls.values()) URL.revokeObjectURL(url);
		this.#objectUrls.clear();
	}

	cacheImage(objectKey: string, addressId: string, blob: Blob, contentType: string): void {
		this.#imageCache.set(objectKey, { blob, contentType });
		this.#imageAddress.set(objectKey, addressId);
	}

	noteImageAddress(objectKey: string, addressId: string): void {
		if (!this.#imageAddress.has(objectKey)) this.#imageAddress.set(objectKey, addressId);
	}

	#addressFor(objectKey: string): string | null {
		const known = this.#imageAddress.get(objectKey);
		if (known) return known;
		const owner = this.items.find((s) => s.bodyHtml.includes(objectKey));
		return owner?.addressId ?? null;
	}

	objectUrl(objectKey: string): string | null {
		return this.#objectUrls.get(objectKey) ?? null;
	}

	async ensureObjectUrl(objectKey: string): Promise<string> {
		const existing = this.#objectUrls.get(objectKey);
		if (existing) return existing;
		const { blob } = await this.fetchImage(objectKey);
		const cached = this.#objectUrls.get(objectKey);
		if (cached) return cached;
		const url = URL.createObjectURL(blob);
		this.#objectUrls.set(objectKey, url);
		return url;
	}

	async fetchImage(objectKey: string): Promise<CachedImage> {
		const cached = this.#imageCache.get(objectKey);
		if (cached) return cached;
		const addressId = this.#addressFor(objectKey);
		if (!addressId) throw new Error('signature image is not referenced by any signature');
		const grant = await getSignatureImageDownloadUrl(addressId, objectKey);
		const resp = await platform.blobFetch(grant.downloadUrl);
		if (!resp.ok) {
			throw new Error(`failed to fetch signature image: HTTP ${resp.status}`);
		}
		const acct = this.#accountId;
		if (!acct) throw new Error('no active account');
		const ciphertext = new Uint8Array(await resp.arrayBuffer());
		const opened = await openSignatureImage(acct, ciphertext);
		const blob = new Blob([opened.bytes as BlobPart], { type: opened.contentType });
		const value: CachedImage = { blob, contentType: opened.contentType };
		this.#imageCache.set(objectKey, value);
		this.#imageAddress.set(objectKey, addressId);
		return value;
	}
}

export const signatures = new SignaturesStore();
