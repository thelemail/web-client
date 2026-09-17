import { reportMessage } from '$core/api/messages';
import { ApiCallError, type MessageReportKind, type ReportMessageRequest } from '$core/api/types';
import { loadOriginalHeaders } from './originalHeaders';

const MAX_HEADER_BYTES = 65536;
const MAX_ADDRESS_CHARS = 320;

export interface ReportOutcome {
	headersRequested: boolean;
	headersIncluded: boolean;
	duplicate: boolean;
}

export function buildReportRequest(
	kind: MessageReportKind,
	consent: boolean,
	headers: string | null,
	senderAddress: string | null | undefined
): ReportMessageRequest {
	const req: ReportMessageRequest = { kind };
	if (!consent) return req;
	const block = (headers ?? '').trim();
	if (block) req.headers = capHeaderBytes(block, MAX_HEADER_BYTES);
	const addr = (senderAddress ?? '').trim();
	if (addr) req.senderAddress = addr.slice(0, MAX_ADDRESS_CHARS);
	return req;
}

export function capHeaderBytes(block: string, maxBytes: number): string {
	const bytes = new TextEncoder().encode(block);
	if (bytes.length <= maxBytes) return block;
	let cut = bytes.subarray(0, maxBytes);
	const newline = cut.lastIndexOf(0x0a);
	if (newline > 0) cut = cut.subarray(0, newline);
	return new TextDecoder().decode(cut).replace(/\uFFFD+$/, '').replace(/\r$/, '');
}

export async function submitReport(
	accountId: string,
	messageId: string,
	opts: { kind: MessageReportKind; includeHeaders: boolean; senderAddress?: string }
): Promise<ReportOutcome> {
	let headers: string | null = null;
	if (opts.includeHeaders) {
		try {
			headers = await loadOriginalHeaders(accountId, messageId);
		} catch {
			headers = null;
		}
	}
	const body = buildReportRequest(opts.kind, opts.includeHeaders, headers, opts.senderAddress);
	const base = {
		headersRequested: opts.includeHeaders,
		headersIncluded: body.headers !== undefined
	};
	try {
		await reportMessage(messageId, body);
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 409) {
			return { ...base, duplicate: true };
		}
		throw err;
	}
	return { ...base, duplicate: false };
}
