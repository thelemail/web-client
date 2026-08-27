import { apiFetch } from './client';
import type { MeResponse } from './types';

export interface UpdateMeInput {
	fullName?: string;
	defaultReplyAddressId?: string | null;
	clearDefaultReply?: boolean;
}

export interface AvatarUploadGrant {
	uploadUrl: string;
	objectKey: string;
	expiresAt: string;
	maxBytes: number;
	acceptedContentTypes: string[];
}

export function updateMe(input: UpdateMeInput): Promise<MeResponse> {
	return apiFetch('/v1/me', { method: 'PATCH', body: input });
}

export function requestAvatarUploadUrl(): Promise<AvatarUploadGrant> {
	return apiFetch('/v1/me/avatar/upload-url', { method: 'POST' });
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

export function updateKeys(input: UpdateKeysInput): Promise<MeResponse> {
	return apiFetch('/v1/me/keys', { method: 'PUT', body: input });
}
