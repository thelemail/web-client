import { apiFetch } from './client';

export interface Signature {
	id: string;
	accountId: string;
	addressId: string;
	bodyHtml: string;
	appendOnReply: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface UpsertSignatureInput {
	bodyHtml: string;
	appendOnReply: boolean;
}

export interface SignatureImage {
	id: string;
	objectKey: string;
	contentType: string;
	sizeBytes: number;
	createdAt: string;
}

export interface SignatureImageUploadGrant {
	uploadUrl: string;
	objectKey: string;
	expiresAt: string;
	maxBytes: number;
	acceptedContentTypes: string[];
}

export interface SignatureImageDownload {
	downloadUrl: string;
	expiresAt: string;
}

export function listSignatures(): Promise<{ signatures: Signature[] }> {
	return apiFetch('/v1/me/signatures');
}

export function upsertSignature(addressId: string, input: UpsertSignatureInput): Promise<Signature> {
	return apiFetch(`/v1/me/addresses/${addressId}/signature`, { method: 'PUT', body: input });
}

export function deleteSignature(addressId: string): Promise<void> {
	return apiFetch(`/v1/me/addresses/${addressId}/signature`, { method: 'DELETE' });
}

export function requestSignatureImageUploadUrl(): Promise<SignatureImageUploadGrant> {
	return apiFetch('/v1/me/signature-images/upload-url', { method: 'POST' });
}

export function commitSignatureImage(objectKey: string): Promise<SignatureImage> {
	return apiFetch('/v1/me/signature-images', { method: 'POST', body: { objectKey } });
}

export function getSignatureImageDownloadUrl(objectKey: string): Promise<SignatureImageDownload> {
	const params = new URLSearchParams({ objectKey });
	return apiFetch(`/v1/me/signature-images/download-url?${params.toString()}`);
}
