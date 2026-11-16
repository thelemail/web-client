import { apiFetchWithStatus } from './client';
import type {
	SearchSourceBarrier,
	SearchSourceChangesPage,
	SearchSourceDescriptorRequestItem,
	SearchSourceDescriptorResponse,
	SearchSourceSnapshotPage
} from './types';

export type SourceResult<T> = { ok: true; value: T } | { ok: false; pending: true; retryAfterSeconds: number };

const PENDING_FALLBACK_SECONDS = 5;

async function sourceCall<T>(path: string, accountId: string, init: { method?: 'POST'; body?: unknown } = {}): Promise<SourceResult<T>> {
	const res = await apiFetchWithStatus<T>(path, { ...init, accountId });
	if (res.status === 202) return { ok: false, pending: true, retryAfterSeconds: res.retryAfterSeconds ?? PENDING_FALLBACK_SECONDS };
	return { ok: true, value: res.body };
}

export function getSourceBarrier(accountId: string): Promise<SourceResult<SearchSourceBarrier>> {
	return sourceCall('/v1/search/sources/barrier', accountId);
}

export function listSourceSnapshot(accountId: string, cursor: string | null): Promise<SourceResult<SearchSourceSnapshotPage>> {
	const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
	return sourceCall(`/v1/search/sources/snapshot${qs}`, accountId);
}

export function listSourceChanges(accountId: string, afterSeq: number, throughSeq?: number): Promise<SourceResult<SearchSourceChangesPage>> {
	const params = new URLSearchParams({ afterSeq: String(afterSeq) });
	if (throughSeq !== undefined) params.set('throughSeq', String(throughSeq));
	return sourceCall(`/v1/search/sources/changes?${params}`, accountId);
}

export function describeSources(
	accountId: string,
	items: readonly SearchSourceDescriptorRequestItem[]
): Promise<SourceResult<SearchSourceDescriptorResponse>> {
	return sourceCall('/v1/search/sources/descriptors', accountId, { method: 'POST', body: { items } });
}
