import { apiFetch } from './client';
import type { DraftDetail, DraftListResponse, DraftRequest, DraftSummary, SortOrder } from './types';

export interface ListDraftsOptions {
	sort?: SortOrder;
	cursor?: string;
	limit?: number;
}

export function listDrafts(opts: ListDraftsOptions = {}): Promise<DraftListResponse> {
	const params = new URLSearchParams();
	if (opts.sort) params.set('sort', opts.sort);
	if (opts.cursor) params.set('cursor', opts.cursor);
	if (opts.limit) params.set('limit', String(opts.limit));
	const qs = params.toString();
	return apiFetch<DraftListResponse>(qs ? `/v1/drafts?${qs}` : '/v1/drafts');
}

export function getDraft(draftId: string): Promise<DraftDetail> {
	return apiFetch<DraftDetail>(`/v1/drafts/${encodeURIComponent(draftId)}`);
}

export function putDraft(draftId: string, req: DraftRequest): Promise<DraftSummary> {
	return apiFetch<DraftSummary>(`/v1/drafts/${encodeURIComponent(draftId)}`, {
		method: 'PUT',
		body: req
	});
}

export function deleteDraft(draftId: string): Promise<void> {
	return apiFetch<void>(`/v1/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
}
