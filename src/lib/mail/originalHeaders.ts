import { getMessage } from '$lib/api/messages';
import { decryptBodyFromUrl } from './decrypt';
import { splitMimeHeaders } from './render/mimeHeaders';

export async function loadOriginalHeaders(accountId: string, messageId: string): Promise<string> {
	const detail = await getMessage(messageId);
	const { plaintext } = await decryptBodyFromUrl(accountId, detail.body.url);
	return splitMimeHeaders(plaintext);
}
