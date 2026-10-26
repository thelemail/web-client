import { apiFetch } from './client';

export interface Signature {
	id: string;
	accountId: string;
	addressId: string;
	bodyHtml: string;
	enabled: boolean;
	appendOnReply: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface SignatureRecord {
	id: string;
	accountId: string;
	addressId: string;
	sealedBody?: string;
	bodyKeyFingerprint?: string;
	bodyHtml?: string;
	enabled: boolean;
	appendOnReply: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface UpsertSignatureInput {
	sealedBody: string;
	bodyKeyFingerprint: string;
	enabled: boolean;
	appendOnReply: boolean;
}

export interface SignatureImage {
	id: string;
	objectKey: string;
	sizeBytes: number;
	ciphertextSha256?: string;
	keyFingerprint?: string;
	createdAt: string;
}

export interface SignatureImageUploadGrant {
	uploadPath: string;
	objectKey: string;
	expiresAt: string;
	maxBytes: number;
}

export interface CommitSignatureImageInput {
	addressId: string;
	objectKey: string;
	ciphertextSizeBytes: number;
	ciphertextSha256: string;
	keyFingerprint: string;
}

export function listSignatures(accountId: string): Promise<{ signatures: SignatureRecord[] }> {
	return apiFetch('/v1/me/signatures', { accountId });
}

export function upsertSignature(
	addressId: string,
	input: UpsertSignatureInput
): Promise<SignatureRecord> {
	return apiFetch(`/v1/me/addresses/${addressId}/signature`, { method: 'PUT', body: input });
}

export function deleteSignature(addressId: string): Promise<void> {
	return apiFetch(`/v1/me/addresses/${addressId}/signature`, { method: 'DELETE' });
}

export interface SignatureImageUploadUrlInput {
	addressId: string;
	ciphertextSizeBytes: number;
	ciphertextSha256: string;
}

export function requestSignatureImageUploadUrl(
	input: SignatureImageUploadUrlInput
): Promise<SignatureImageUploadGrant> {
	return apiFetch('/v1/me/signature-images/upload-url', { method: 'POST', body: input });
}

export function commitSignatureImage(input: CommitSignatureImageInput): Promise<SignatureImage> {
	return apiFetch('/v1/me/signature-images', { method: 'POST', body: input });
}

export function signatureImageContentPath(addressId: string, objectKey: string): string {
	const params = new URLSearchParams({ addressId, objectKey });
	return `/v1/me/signature-images/content?${params.toString()}`;
}
