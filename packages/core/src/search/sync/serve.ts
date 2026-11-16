import { describeSources, getSourceBarrier, listSourceChanges, listSourceSnapshot, type SourceResult } from '../../api/searchSources';
import { getDraft } from '../../api/drafts';
import { ApiCallError } from '../../api/types';
import { BlobChangedError, DecryptionError, decryptPreviewRaw, decryptStoredBody } from '../../mail/decrypt';
import { fetchAttachmentHeader } from '../../mail/attachments';
import type { BridgeFailure, BridgeMessage, BridgeReply, BridgeRequest, BridgeResult, BridgeValues } from './protocol';

const EXPIRED = new Set(['source_cursor_expired', 'source_snapshot_expired']);

export function failureOf(error: unknown): BridgeFailure {
	if (error instanceof BlobChangedError) return { code: 'changed' };
	if (error instanceof DecryptionError) {
		switch (error.code) {
			case 'no_matching_key':
				return { code: 'locked' };
			case 'locked':
				return { code: 'vault_locked' };
			case 'invalid_ciphertext':
				return { code: 'failed', reason: 'ciphertext' };
			default:
				return { code: 'failed', reason: 'unknown' };
		}
	}
	if (error instanceof ApiCallError) {
		const code = error.envelope?.error?.code;
		if (code && EXPIRED.has(code)) {
			return { code: 'expired', minRetainedSeq: error.envelope?.error?.minRetainedSeq ?? null, committedSeq: error.envelope?.error?.committedSeq ?? null };
		}
		if (error.status === 404) return { code: 'gone' };
		if (error.status === 0 || error.status === 401 || error.status === 408 || error.status === 429 || error.status >= 500) {
			return { code: 'retry', retryAfterSeconds: error.retryAfterSeconds };
		}
		return { code: 'failed', reason: 'unknown' };
	}
	if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) return { code: 'retry', retryAfterSeconds: null };
	if (error instanceof SyntaxError) return { code: 'failed', reason: 'malformed' };
	return { code: 'failed', reason: 'unknown' };
}

function source<T>(res: SourceResult<T>): BridgeResult<T> {
	return res.ok ? { ok: true, value: res.value } : { ok: false, failure: { code: 'pending', retryAfterSeconds: res.retryAfterSeconds } };
}

async function perform(accountId: string, r: BridgeRequest): Promise<BridgeResult<BridgeValues[BridgeRequest['op']]>> {
	switch (r.op) {
		case 'barrier':
			return source(await getSourceBarrier(accountId));
		case 'snapshot':
			return source(await listSourceSnapshot(accountId, r.cursor));
		case 'changes':
			return source(await listSourceChanges(accountId, r.afterSeq, r.throughSeq));
		case 'describe':
			return source(await describeSources(accountId, r.items));
		case 'preview':
			return { ok: true, value: await decryptPreviewRaw(accountId, r.data) };
		case 'body': {
			const body = await decryptStoredBody(accountId, r.pointer);
			return { ok: true, value: body };
		}
		case 'draft': {
			const detail = await getDraft(r.draftId, accountId);
			if (detail.body.sha256 !== r.pointer.sha256 || detail.body.sizeBytes !== r.pointer.sizeBytes) return { ok: false, failure: { code: 'changed' } };
			const body = await decryptStoredBody(accountId, r.pointer);
			return { ok: true, value: { storedBytes: body.storedBytes, json: body.mime, updatedAt: detail.updatedAt } };
		}
		case 'attachment': {
			const res = await fetchAttachmentHeader(accountId, r.pointer);
			if (res.ok) {
				const h = res.header;
				return { ok: true, value: { filename: h.filename, contentType: h.contentType, inline: h.disposition === 'inline', size: h.plaintextSize } };
			}
			switch (res.code) {
				case 'no_matching_key':
					return { ok: false, failure: { code: 'locked' } };
				case 'locked':
					return { ok: false, failure: { code: 'vault_locked' } };
				case 'network':
					return { ok: false, failure: { code: 'retry', retryAfterSeconds: null } };
				case 'invalid_ciphertext':
					return { ok: false, failure: { code: 'failed', reason: 'ciphertext' } };
				default:
					return { ok: false, failure: { code: 'failed', reason: 'unknown' } };
			}
		}
	}
}

function transfers(result: BridgeResult<unknown>): Transferable[] {
	if (!result.ok) return [];
	const v = result.value as { mime?: Uint8Array; json?: Uint8Array };
	const bytes = v?.mime ?? v?.json;
	return bytes ? [bytes.buffer] : [];
}

export function serveBridge(accountId: string, port: MessagePort): () => void {
	let open = true;
	port.onmessage = async (e: MessageEvent<BridgeMessage>) => {
		const { id, ...request } = e.data;
		let result: BridgeResult<unknown>;
		try {
			result = await perform(accountId, request as BridgeRequest);
		} catch (error) {
			result = { ok: false, failure: failureOf(error) };
		}
		if (open) port.postMessage({ id, result } satisfies BridgeReply, transfers(result));
	};
	port.start();
	return () => {
		open = false;
		port.onmessage = null;
		port.close();
	};
}
