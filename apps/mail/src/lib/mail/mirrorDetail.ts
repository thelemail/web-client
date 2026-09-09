import type { MessageDetail, AttachmentDetail } from '$lib/api/types';
import type { MirrorMessage } from '$lib/platform/types';

const ABSENT_POINTER = {
	url: '',
	expiresAt: new Date(0).toISOString(),
	sizeBytes: 0
};

function parseJson<T>(raw: string, fallback: T): T {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export function detailFromMirror(message: MirrorMessage): MessageDetail {
	const attachments: AttachmentDetail[] = message.attachments.map((a) => ({
		id: a.id,
		ordinal: a.ordinal,
		isInline: a.isInline,
		pointer: { ...ABSENT_POINTER, sizeBytes: a.plaintextSize }
	}));

	return {
		id: message.id,
		ownerAccountId: '',
		direction: message.direction,
		source: message.source as MessageDetail['source'],
		storedAt: message.storedAt,
		encryptedPreview: '',
		schemaVersion: 0,
		body: ABSENT_POINTER,
		attachments,
		mailboxState: message.mailboxState as MessageDetail['mailboxState'],
		starred: message.starred,
		read: message.read,
		threadRootId: message.threadRootId ?? undefined,
		externalMessageId: message.externalMessageId ?? undefined,
		inReplyTo: message.inReplyTo ?? undefined,
		labels: parseJson<string[]>(message.labelsJson, []),
		signatureStatus: (message.signatureStatus ?? undefined) as MessageDetail['signatureStatus']
	};
}
