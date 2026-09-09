import { apiFetch } from './client';
import type {
	AddBlockedSenderRequest,
	BlockedSender,
	BlockedSenderListResponse
} from './types';

export function listBlockedSenders(): Promise<BlockedSenderListResponse> {
	return apiFetch<BlockedSenderListResponse>('/v1/blocked-senders');
}

export function addBlockedSender(req: AddBlockedSenderRequest): Promise<BlockedSender> {
	return apiFetch<BlockedSender>('/v1/blocked-senders', { method: 'POST', body: req });
}

export function deleteBlockedSender(id: string): Promise<void> {
	return apiFetch<void>(`/v1/blocked-senders/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
