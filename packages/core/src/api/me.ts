import { apiFetch } from './client';
import type { AccountKeyListResponse, KeyRotationRequest, MeResponse } from './types';

export interface UpdateMeInput {
	fullName?: string;
	defaultReplyAddressId?: string | null;
	clearDefaultReply?: boolean;
}

export interface AvatarUploadUrlInput {
	sizeBytes: number;
	sha256: string;
	contentType: string;
}

export interface AvatarUploadGrant {
	uploadUrl: string;
	uploadPath: string;
	uploadHeaders: Record<string, string>;
	objectKey: string;
	expiresAt: string;
	maxBytes: number;
	acceptedContentTypes: string[];
}

export function updateMe(input: UpdateMeInput): Promise<MeResponse> {
	return apiFetch('/v1/me', { method: 'PATCH', body: input });
}

export function requestAvatarUploadUrl(input: AvatarUploadUrlInput): Promise<AvatarUploadGrant> {
	return apiFetch('/v1/me/avatar/upload-url', { method: 'POST', body: input });
}

export function commitAvatar(objectKey: string): Promise<MeResponse> {
	return apiFetch('/v1/me/avatar', { method: 'POST', body: { objectKey } });
}

export function deleteAvatar(): Promise<MeResponse> {
	return apiFetch('/v1/me/avatar', { method: 'DELETE' });
}

export interface UpdateKeysInput {
	publicKeyArmored: string;
	encryptedPrivateKey: string;
}

export function updateKeys(input: UpdateKeysInput, accountId?: string): Promise<MeResponse> {
	return apiFetch('/v1/me/keys', { method: 'PUT', body: input, accountId });
}

export function listMyKeys(accountId?: string): Promise<AccountKeyListResponse> {
	return apiFetch('/v1/me/keys', { accountId });
}

export function rotateAccountKey(input: KeyRotationRequest, accountId?: string): Promise<unknown> {
	return apiFetch('/v1/me/keys/rotations', { method: 'POST', body: input, accountId });
}
