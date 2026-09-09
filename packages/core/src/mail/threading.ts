export interface ReplyThreadIds {
	seedId: string;
	externalMessageId?: string;
	references?: string[];
}

export interface ReplyThreadHeaders {
	inReplyToMessageId: string;
	inReplyToHeader?: string;
	references?: string[];
}

export function mergeReferences(
	existing: string[] | undefined,
	parent: string | undefined
): string[] {
	const out: string[] = [];
	for (const r of existing ?? []) {
		if (r && !out.includes(r)) out.push(r);
	}
	if (parent && !out.includes(parent)) out.push(parent);
	return out;
}

export function replyThreadHeaders(ids: ReplyThreadIds): ReplyThreadHeaders {
	const refs = mergeReferences(ids.references, ids.externalMessageId);
	return {
		inReplyToMessageId: ids.seedId,
		inReplyToHeader: ids.externalMessageId,
		references: refs.length ? refs : undefined
	};
}
