import { submissionFetch, submissionUpload, type UploadOptions } from './client';
import type {
	SubmissionIntent,
	SubmitMessageRequest,
	SubmitMessageResponse,
	SubmitOutcome
} from './types';

export async function submitExternal(req: SubmitMessageRequest): Promise<SubmitOutcome> {
	const body = await submissionFetch<SubmitMessageResponse | SubmissionIntent>('/v1/messages', {
		method: 'POST',
		body: req
	});
	if ('intentId' in body) return { kind: 'intent', intent: body };
	return { kind: 'accepted', response: body };
}

export function uploadIntentMessage(
	intent: SubmissionIntent,
	message: Blob,
	opts: UploadOptions = {}
): Promise<SubmitMessageResponse> {
	return submissionUpload<SubmitMessageResponse>(intent.uploadUrl, message, 'message/rfc822', opts);
}
