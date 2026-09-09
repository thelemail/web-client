import { reportMessage } from '$lib/api/messages';
import { ApiCallError, type MessageReportKind, type ReportMessageRequest } from '$lib/api/types';
import { loadOriginalHeaders } from './originalHeaders';

const MAX_HEADER_CHARS = 65536;
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
	if (block) req.headers = block.slice(0, MAX_HEADER_CHARS);
	const addr = (senderAddress ?? '').trim();
	if (addr) req.senderAddress = addr.slice(0, MAX_ADDRESS_CHARS);
	return req;
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
