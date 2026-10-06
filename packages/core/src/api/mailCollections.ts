import { apiFetch } from './client';
import type {
	CreateMailCollectionRequest,
	FolderDestination,
	MailCollectionListResponse,
	MailCollectionRecord,
	ReorderMailCollectionsRequest,
	UpdateMailCollectionRequest
} from './types';

const BASE = '/v1/mail/collections';

export function listMailCollections(accountId: string): Promise<MailCollectionListResponse> {
	return apiFetch<MailCollectionListResponse>(BASE, { accountId });
}

export function createMailCollection(
	accountId: string,
	body: CreateMailCollectionRequest
): Promise<MailCollectionRecord> {
	return apiFetch<MailCollectionRecord>(BASE, { method: 'POST', body, accountId });
}

export function updateMailCollection(
	accountId: string,
	id: string,
	body: UpdateMailCollectionRequest
): Promise<MailCollectionRecord> {
	return apiFetch<MailCollectionRecord>(`${BASE}/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		body,
		accountId
	});
}

export function reorderMailCollections(
	accountId: string,
	body: ReorderMailCollectionsRequest
): Promise<MailCollectionListResponse> {
	return apiFetch<MailCollectionListResponse>(`${BASE}/order`, { method: 'PUT', body, accountId });
}

export function deleteMailCollection(
	accountId: string,
	id: string,
	baseRev: number,
	destination?: { kind: FolderDestination; folderId?: string }
): Promise<MailCollectionRecord> {
	const params = new URLSearchParams({ baseRev: String(baseRev) });
	if (destination) {
		params.set('destination', destination.kind);
		if (destination.folderId) params.set('destinationFolderId', destination.folderId);
	}
	return apiFetch<MailCollectionRecord>(`${BASE}/${encodeURIComponent(id)}?${params}`, {
		method: 'DELETE',
		accountId
	});
}
