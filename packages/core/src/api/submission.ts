import { submissionFetch } from './client';
import type {
	StagingUrlsRequest,
	StagingUrlsResponse,
	SubmitMessageRequest,
	SubmitMessageResponse
} from './types';

export function submitExternal(req: SubmitMessageRequest): Promise<SubmitMessageResponse> {
	return submissionFetch<SubmitMessageResponse>('/v1/messages', { method: 'POST', body: req });
}

export function issueStagingUrls(req: StagingUrlsRequest): Promise<StagingUrlsResponse> {
	return submissionFetch<StagingUrlsResponse>('/v1/submission/staging-urls', {
		method: 'POST',
		body: req
	});
}
