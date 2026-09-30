import { m } from '$paraglide/messages.js';
import { addresses } from '$core/stores/addresses.svelte';

export interface SentBy {
	aliasId: string;
	accountId: string;
}

export function sentByFrom(item: { sentViaAliasId?: string; sentByAccountId?: string }): SentBy | undefined {
	if (!item.sentViaAliasId || !item.sentByAccountId) return undefined;
	return { aliasId: item.sentViaAliasId, accountId: item.sentByAccountId };
}

export function sentByName(sentBy: SentBy, selfAccountId: string | null): string | null {
	if (sentBy.accountId === selfAccountId) return null;
	const member = addresses.aliasMember(sentBy.aliasId, sentBy.accountId);
	if (!member) return null;
	return member.fullName.trim() || member.email;
}

export function sentByLabel(sentBy: SentBy | undefined, selfAccountId: string | null): string | null {
	if (!sentBy) return null;
	if (sentBy.accountId === selfAccountId) return m.mail_sent_by_you();
	const name = sentByName(sentBy, selfAccountId);
	return name ? m.mail_sent_by({ name }) : m.mail_sent_by_former_member();
}
