import { platform } from '$platform';
import { fetchRemoteImages } from '$core/api/messages';
import {
	requestSignatureImageUploadUrl,
	commitSignatureImage,
	type SignatureImage
} from '$core/api/signatures';
import { signatures } from '$core/stores/signatures.svelte';
import { sealSignatureImage } from './signatureCrypto';
import { SIGNATURE_IMAGE_ATTR } from './editor/signatureImage';
import { b64ToBytes } from '$core/keys/encode';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_REMOTE_FETCH = 20;
const CONCURRENCY = 4;

export interface HostedImage {
	objectKey: string;
	contentType: string;
}

export async function uploadSignatureImage(
	addressId: string,
	bytes: Uint8Array,
	meta: { filename: string; contentType: string }
): Promise<HostedImage> {
	if (!ACCEPTED_IMAGE_TYPES.includes(meta.contentType)) {
		throw new Error('Use a JPG, PNG, GIF, or WebP image.');
	}
	if (bytes.byteLength > MAX_IMAGE_BYTES) {
		throw new Error(`Maximum size is ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB.`);
	}
	const target = signatures.targetFor(addressId);
	if (!target) throw new Error('no active account');

	const sealedImage = await sealSignatureImage(target, bytes, meta);
	const grant = await requestSignatureImageUploadUrl(addressId);
	if (sealedImage.ciphertext.byteLength > grant.maxBytes) {
		throw new Error('That image is too large once encrypted. Try a smaller one.');
	}
	const put = await platform.blobPut(
		grant.uploadUrl,
		new Blob([sealedImage.ciphertext as BlobPart], { type: 'application/octet-stream' }),
		'application/octet-stream'
	);
	if (!put.ok) throw new Error(`upload failed (${put.status})`);

	const committed: SignatureImage = await commitSignatureImage({
		addressId,
		objectKey: grant.objectKey,
		ciphertextSizeBytes: sealedImage.ciphertext.byteLength,
		ciphertextSha256: sealedImage.ciphertextSha256,
		keyFingerprint: sealedImage.keyFingerprint
	});
	signatures.cacheImage(
		committed.objectKey,
		addressId,
		new Blob([bytes as BlobPart], { type: meta.contentType }),
		meta.contentType
	);
	return { objectKey: committed.objectKey, contentType: meta.contentType };
}

function decodeDataUri(src: string): { bytes: Uint8Array; contentType: string } | null {
	const m = /^data:([^;,]+)(;base64)?,(.*)$/i.exec(src);
	if (!m) return null;
	const contentType = m[1].toLowerCase();
	try {
		if (m[2]) return { bytes: b64ToBytes(m[3]), contentType };
		return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), contentType };
	} catch {
		return null;
	}
}

function extensionFor(contentType: string): string {
	if (contentType === 'image/jpeg') return 'jpg';
	if (contentType === 'image/png') return 'png';
	if (contentType === 'image/gif') return 'gif';
	if (contentType === 'image/webp') return 'webp';
	return 'bin';
}

export interface HostResult {
	html: string;
	hosted: number;
	failed: number;
}

export async function hostSignatureImages(
	addressId: string,
	html: string
): Promise<HostResult> {
	if (!html || typeof DOMParser === 'undefined') return { html, hosted: 0, failed: 0 };
	const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
	const wrapper = doc.body.firstElementChild as HTMLElement | null;
	if (!wrapper) return { html, hosted: 0, failed: 0 };

	const pending = Array.from(wrapper.querySelectorAll('img')).filter(
		(img) => !img.hasAttribute(SIGNATURE_IMAGE_ATTR)
	);
	if (pending.length === 0) return { html, hosted: 0, failed: 0 };

	const remoteUrls = [
		...new Set(
			pending
				.map((img) => img.getAttribute('src') ?? '')
				.filter((src) => /^https?:/i.test(src))
		)
	].slice(0, MAX_REMOTE_FETCH);

	const fetched = new Map<string, { bytes: Uint8Array; contentType: string }>();
	if (remoteUrls.length > 0) {
		try {
			const res = await fetchRemoteImages({ urls: remoteUrls });
			for (const img of res.images) {
				fetched.set(img.url, {
					bytes: b64ToBytes(img.dataBase64),
					contentType: img.contentType.toLowerCase()
				});
			}
		} catch {
			return { html, hosted: 0, failed: pending.length };
		}
	}

	let hosted = 0;
	let failed = 0;
	const hostedByKey = new Map<string, HostedImage>();

	const work = pending.map((img) => async () => {
		const src = img.getAttribute('src') ?? '';
		const source = /^data:/i.test(src) ? decodeDataUri(src) : (fetched.get(src) ?? null);
		if (!source || !ACCEPTED_IMAGE_TYPES.includes(source.contentType)) {
			img.remove();
			failed++;
			return;
		}
		const cacheKey = /^data:/i.test(src) ? `${src.length}:${source.contentType}` : src;
		const already = hostedByKey.get(cacheKey);
		if (already) {
			img.setAttribute(SIGNATURE_IMAGE_ATTR, already.objectKey);
			img.setAttribute('src', '');
			img.removeAttribute('srcset');
			return;
		}
		try {
			const out = await uploadSignatureImage(addressId, source.bytes, {
				filename: `signature.${extensionFor(source.contentType)}`,
				contentType: source.contentType
			});
			hostedByKey.set(cacheKey, out);
			img.setAttribute(SIGNATURE_IMAGE_ATTR, out.objectKey);
			img.setAttribute('src', '');
			img.removeAttribute('srcset');
			hosted++;
		} catch {
			img.remove();
			failed++;
		}
	});

	for (let i = 0; i < work.length; i += CONCURRENCY) {
		await Promise.all(work.slice(i, i + CONCURRENCY).map((fn) => fn()));
	}

	return { html: wrapper.innerHTML, hosted, failed };
}
