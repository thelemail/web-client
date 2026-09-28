import { browser } from '$app/environment';
import { platform } from '$platform';
import { keystore } from '$core/keystore/keystore-client';
import { aliasKeys } from '$core/stores/aliasKeys.svelte';
import type { AttachmentFailureCode } from '$core/keystore/protocol';
import type { DecryptedAttachmentHeader } from '$core/mail/attframe';
import type { AttachmentDetail, PresignedPointer } from '$core/api/types';

export type AttachmentDecryptError = AttachmentFailureCode;

export class AttachmentError extends Error {
	code: AttachmentDecryptError;
	constructor(code: AttachmentDecryptError, message?: string) {
		super(message ?? code);
		this.code = code;
		this.name = 'AttachmentError';
	}
}

export interface DecryptedAttachment {
	header: DecryptedAttachmentHeader;
	blob: Blob;
}

export type PointerRefresh = (attachmentId: string) => Promise<PresignedPointer | null>;

const HEADER_CONCURRENCY = 2;
const HEADER_CACHE_MAX = 500;
const BYTES_CACHE_MAX_ENTRIES = 3;
const BYTES_CACHE_MAX_BYTES = 60 * 1024 * 1024;

const headerCache = new Map<string, DecryptedAttachmentHeader>();
const inFlight = new Map<string, Promise<DecryptedAttachmentHeader>>();
const bytesCache = new Map<string, DecryptedAttachment>();
const bytesInFlight = new Map<string, Promise<DecryptedAttachment>>();

let active = 0;
const waiting: (() => void)[] = [];

async function gate<T>(run: () => Promise<T>): Promise<T> {
	if (active >= HEADER_CONCURRENCY) {
		await new Promise<void>((resolve) => waiting.push(resolve));
	}
	active++;
	try {
		return await run();
	} finally {
		active--;
		waiting.shift()?.();
	}
}

function cacheKey(accountId: string, attachmentId: string): string {
	return `${accountId}:${attachmentId}`;
}

function cacheHeader(key: string, header: DecryptedAttachmentHeader): void {
	headerCache.delete(key);
	headerCache.set(key, header);
	while (headerCache.size > HEADER_CACHE_MAX) {
		const oldest = headerCache.keys().next().value;
		if (oldest === undefined) break;
		headerCache.delete(oldest);
	}
}

function cacheBytes(key: string, dec: DecryptedAttachment): void {
	bytesCache.delete(key);
	if (dec.blob.size > BYTES_CACHE_MAX_BYTES) return;
	bytesCache.set(key, dec);
	let total = 0;
	for (const entry of bytesCache.values()) total += entry.blob.size;
	while (bytesCache.size > BYTES_CACHE_MAX_ENTRIES || total > BYTES_CACHE_MAX_BYTES) {
		const oldest = bytesCache.keys().next();
		if (oldest.done) break;
		total -= bytesCache.get(oldest.value)?.blob.size ?? 0;
		bytesCache.delete(oldest.value);
	}
}

function dropBytesFor(accountId: string | null): void {
	for (const key of [...bytesCache.keys()]) {
		if (accountId === null || key.startsWith(`${accountId}:`)) bytesCache.delete(key);
	}
}

let subscribed = false;
function subscribeOnce(): void {
	if (subscribed || !browser) return;
	subscribed = true;
	try {
		keystore.subscribe((msg) => {
			if (msg.type === 'cleared' || msg.type === 'locked') dropBytesFor(msg.accountId);
			else if (msg.type === 'clearedAll') dropBytesFor(null);
		});
	} catch {
		subscribed = false;
	}
}
subscribeOnce();

async function withFreshPointer<T>(
	chip: AttachmentChip,
	refresh: PointerRefresh | undefined,
	run: (pointer: PresignedPointer) => Promise<{ ok: true; value: T } | { ok: false; code: AttachmentDecryptError }>
): Promise<T> {
	let result = await run(chip.pointer);
	if (!result.ok && result.code === 'network' && refresh) {
		const fresh = await refresh(chip.id);
		if (fresh) result = await run(fresh);
	}
	if (!result.ok) throw new AttachmentError(result.code);
	return result.value;
}

export async function loadAttachmentHeader(
	accountId: string,
	chip: AttachmentChip,
	refresh?: PointerRefresh
): Promise<DecryptedAttachmentHeader> {
	const key = cacheKey(accountId, chip.id);
	const cached = headerCache.get(key);
	if (cached) return cached;
	const running = inFlight.get(key);
	if (running) return running;

	const task = gate(async () => {
		await aliasKeys.ready(accountId);
		const header = await withFreshPointer<DecryptedAttachmentHeader>(
			chip,
			refresh,
			async (pointer) => {
				const res = await keystore.attachmentHeader({
					accountId,
					url: pointer.url,
					keyFingerprintHex: pointer.keyFingerprint
				});
				return res.ok ? { ok: true, value: res.header } : { ok: false, code: res.code };
			}
		);
		cacheHeader(key, header);
		return header;
	}).finally(() => inFlight.delete(key));

	inFlight.set(key, task);
	return task;
}

async function attachmentBytes(
	accountId: string,
	chip: AttachmentChip,
	refresh?: PointerRefresh
): Promise<DecryptedAttachment> {
	const key = cacheKey(accountId, chip.id);
	const cached = bytesCache.get(key);
	if (cached) {
		cacheBytes(key, cached);
		return cached;
	}
	const running = bytesInFlight.get(key);
	if (running) return running;

	const task = (async () => {
		await aliasKeys.ready(accountId);
		const dec = await withFreshPointer<DecryptedAttachment>(chip, refresh, async (pointer) => {
			const res = await keystore.attachmentBytes({
				accountId,
				url: pointer.url,
				attachmentId: chip.id,
				keyFingerprintHex: pointer.keyFingerprint
			});
			return res.ok
				? { ok: true, value: { header: res.header, blob: res.payload } }
				: { ok: false, code: res.code };
		});
		cacheHeader(key, dec.header);
		cacheBytes(key, dec);
		return dec;
	})().finally(() => bytesInFlight.delete(key));

	bytesInFlight.set(key, task);
	return task;
}

export function loadAttachmentBytes(
	accountId: string,
	chip: AttachmentChip,
	refresh?: PointerRefresh
): Promise<DecryptedAttachment> {
	return attachmentBytes(accountId, chip, refresh);
}

export async function decryptAttachmentFull(
	accountId: string,
	pointer: PresignedPointer
): Promise<DecryptedAttachment> {
	await aliasKeys.ready(accountId);
	const res = await keystore.attachmentBytes({
		accountId,
		url: pointer.url,
		keyFingerprintHex: pointer.keyFingerprint
	});
	if (!res.ok) throw new AttachmentError(res.code);
	return { header: res.header, blob: res.payload };
}

export async function downloadAttachment(
	accountId: string,
	chip: AttachmentChip,
	refresh?: PointerRefresh
): Promise<DecryptedAttachmentHeader> {
	const dec = await attachmentBytes(accountId, chip, refresh);
	await platform.saveBlob(dec.blob, dec.header.filename || 'attachment');
	return dec.header;
}

export type AttachmentChip = {
	id: string;
	ordinal: number;
	pointer: PresignedPointer;
	state: 'loading' | 'ready' | 'error';
	header?: DecryptedAttachmentHeader;
	error?: string;
};

export function initialChips(atts: AttachmentDetail[]): AttachmentChip[] {
	return atts
		.filter((a) => !a.isInline)
		.map((a) => ({
			id: a.id,
			ordinal: a.ordinal,
			pointer: a.pointer,
			state: 'loading'
		}));
}
