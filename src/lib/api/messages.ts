import { apiFetch } from './client';
import type {
	AttachmentUploadUrlsRequest,
	AttachmentUploadUrlsResponse,
	ClientInboundImportRequest,
	ClientInboundImportResponse,
	FetchImagesRequest,
	FetchImagesResponse,
	ResolveBimiRequest,
	ResolveBimiResponse,
	InternalSendRequest,
	InternalSendResponse,
	LabelsRequest,
	MailboxCounts,
	MailboxState,
	MessageDetail,
	MessageDirection,
	MessageListResponse,
	MessageState,
	ReportMessageRequest,
	RsvpRequest,
	SnoozeRequest,
	SortOrder,
	ThreadListResponse,
	ThreadResponse
} from './types';

export function issueAttachmentUploadUrls(
	req: AttachmentUploadUrlsRequest
): Promise<AttachmentUploadUrlsResponse> {
	return apiFetch<AttachmentUploadUrlsResponse>('/v1/attachments/upload-urls', {
		method: 'POST',
		body: req
	});
}

export interface ListMessagesOptions {
	direction?: MessageDirection;
	mailbox?: MailboxState;
	starred?: boolean;
	snoozed?: boolean;
	unread?: boolean;
	hasAttachments?: boolean;
	labels?: string[];
	sort?: SortOrder;
	cursor?: string;
	limit?: number;
}

export function listMessages(opts: ListMessagesOptions = {}): Promise<MessageListResponse> {
	const params = new URLSearchParams();
	if (opts.direction) params.set('direction', opts.direction);
	if (opts.mailbox) params.set('mailbox', opts.mailbox);
	if (opts.starred) params.set('starred', 'true');
	if (opts.snoozed) params.set('snoozed', 'true');
	if (opts.unread) params.set('unread', 'true');
	if (opts.hasAttachments) params.set('hasAttachments', 'true');
	if (opts.labels && opts.labels.length) params.set('labels', opts.labels.join(','));
	if (opts.sort) params.set('sort', opts.sort);
	if (opts.cursor) params.set('cursor', opts.cursor);
	if (opts.limit) params.set('limit', String(opts.limit));
	const qs = params.toString();
	return apiFetch<MessageListResponse>(qs ? `/v1/messages?${qs}` : '/v1/messages');
}

export type ListThreadsOptions = Omit<ListMessagesOptions, 'direction'>;

export function listThreads(opts: ListThreadsOptions = {}): Promise<ThreadListResponse> {
	const params = new URLSearchParams();
	if (opts.mailbox) params.set('mailbox', opts.mailbox);
	if (opts.starred) params.set('starred', 'true');
	if (opts.snoozed) params.set('snoozed', 'true');
	if (opts.unread) params.set('unread', 'true');
	if (opts.hasAttachments) params.set('hasAttachments', 'true');
	if (opts.labels && opts.labels.length) params.set('labels', opts.labels.join(','));
	if (opts.sort) params.set('sort', opts.sort);
	if (opts.cursor) params.set('cursor', opts.cursor);
	if (opts.limit) params.set('limit', String(opts.limit));
	const qs = params.toString();
	return apiFetch<ThreadListResponse>(qs ? `/v1/threads?${qs}` : '/v1/threads');
}

export function getMailboxCounts(): Promise<MailboxCounts> {
	return apiFetch<MailboxCounts>('/v1/messages/counts');
}

export function getMessage(messageId: string): Promise<MessageDetail> {
	return apiFetch<MessageDetail>(`/v1/messages/${encodeURIComponent(messageId)}`);
}

export function deleteMessage(messageId: string): Promise<void> {
	return apiFetch<void>(`/v1/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
}

export function sendInternal(req: InternalSendRequest): Promise<InternalSendResponse> {
	return apiFetch<InternalSendResponse>('/v1/messages', { method: 'POST', body: req });
}

export function importMessage(
	req: ClientInboundImportRequest
): Promise<ClientInboundImportResponse> {
	return apiFetch<ClientInboundImportResponse>('/v1/messages/import', {
		method: 'POST',
		body: req
	});
}

export function fetchRemoteImages(req: FetchImagesRequest): Promise<FetchImagesResponse> {
	return apiFetch<FetchImagesResponse>('/v1/images/fetch', { method: 'POST', body: req });
}

export function resolveBimi(req: ResolveBimiRequest): Promise<ResolveBimiResponse> {
	return apiFetch<ResolveBimiResponse>('/v1/bimi/resolve', { method: 'POST', body: req });
}

function statePath(messageId: string, suffix: string): string {
	return `/v1/messages/${encodeURIComponent(messageId)}/${suffix}`;
}

export function archiveMessage(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'archive'), { method: 'POST' });
}

export function trashMessage(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'trash'), { method: 'POST' });
}

export function markMessageSpam(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'spam'), { method: 'POST' });
}

export function reportMessage(messageId: string, body: ReportMessageRequest): Promise<void> {
	return apiFetch<void>(statePath(messageId, 'report'), { method: 'POST', body });
}

export function snoozeMessage(messageId: string, until: string): Promise<MessageState> {
	const body: SnoozeRequest = { until };
	return apiFetch<MessageState>(statePath(messageId, 'snooze'), { method: 'POST', body });
}

export function unsnoozeMessage(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'snooze'), { method: 'DELETE' });
}

export function restoreMessage(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'restore'), { method: 'POST' });
}

export function starMessage(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'star'), { method: 'POST' });
}

export function unstarMessage(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'star'), { method: 'DELETE' });
}

export function markMessageRead(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'read'), { method: 'POST' });
}

export function markMessageUnread(messageId: string): Promise<MessageState> {
	return apiFetch<MessageState>(statePath(messageId, 'read'), { method: 'DELETE' });
}

export function getMessageThread(messageId: string): Promise<ThreadResponse> {
	return apiFetch<ThreadResponse>(statePath(messageId, 'thread'));
}

export function setMessageRsvp(messageId: string, body: RsvpRequest): Promise<void> {
	return apiFetch<void>(statePath(messageId, 'rsvp'), { method: 'PATCH', body });
}

export function setMessageLabels(messageId: string, body: LabelsRequest): Promise<void> {
	return apiFetch<void>(statePath(messageId, 'labels'), { method: 'PATCH', body });
}
