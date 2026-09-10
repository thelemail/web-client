import { apiFetch } from './client';
import type { ScheduledSendListResponse } from './types';

export interface ListScheduledSendsOptions {
	cursor?: string;
	limit?: number;
}

export function listScheduledSends(
	opts: ListScheduledSendsOptions = {}
): Promise<ScheduledSendListResponse> {
	const params = new URLSearchParams();
	if (opts.cursor) params.set('cursor', opts.cursor);
	if (opts.limit) params.set('limit', String(opts.limit));
	const qs = params.toString();
	return apiFetch<ScheduledSendListResponse>(
		qs ? `/v1/scheduled-sends?${qs}` : '/v1/scheduled-sends'
	);
}

export function cancelScheduledSend(id: string): Promise<void> {
	return apiFetch<void>(`/v1/scheduled-sends/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
