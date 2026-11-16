import type { ParseRequest, ParseResult } from '../extract/parse';

export const CONNECT = 'thelemail-parser:connect';
export const HELLO = 'thelemail-parser:hello';
export const MAX_JOB_BYTES = 64 * 1024 * 1024;

export interface ConnectMessage {
	type: typeof CONNECT;
	nonce: string;
}

export type ControlEvent = { type: 'ready' } | { type: 'failed' };

export interface JobTicket {
	type: 'job';
	jobId: string;
	source: string;
	revision: number;
	size: number;
}

export type ParseFailure = 'timeout' | 'crashed' | 'limit' | 'unavailable' | 'rejected';

export interface JobInput {
	jobId: string;
	request: ParseRequest;
}

export type JobOutcome = { jobId: string; ok: true; result: ParseResult } | { jobId: string; ok: false; reason: ParseFailure };

export function requestSize(request: ParseRequest): number {
	return request.bytes.byteLength;
}

export function validRequest(value: unknown): value is ParseRequest {
	if (!value || typeof value !== 'object') return false;
	const r = value as Record<string, unknown>;
	if (!(r.bytes instanceof Uint8Array)) return false;
	switch (r.kind) {
		case 'mime':
		case 'draft':
			return true;
		case 'file':
			return typeof r.filename === 'string' && typeof r.mime === 'string';
		case 'part':
			return typeof r.filename === 'string' && typeof r.mime === 'string' && Number.isInteger(r.index) && (r.index as number) >= 0;
		default:
			return false;
	}
}
