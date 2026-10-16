import { getMessage } from '$core/api/messages';
import { decryptBody } from './decrypt';
import { splitMimeHeaders } from './render/mimeHeaders';

export async function loadOriginalHeaders(accountId: string, messageId: string): Promise<string> {
	const detail = await getMessage(messageId);
	const { plaintext } = await decryptBody(accountId, detail.body);
	return splitMimeHeaders(plaintext);
}
